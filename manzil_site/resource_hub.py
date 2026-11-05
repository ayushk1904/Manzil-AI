"""The Resource Hub's search: Tavily for resources, OpenAlex for papers, YouTube for videos, saved links as a fallback."""
import asyncio
import json
import os
import re
import ssl
import urllib.parse
from pathlib import Path

import httpx
from fastapi import APIRouter
from fastapi.responses import JSONResponse

FALLBACKS = json.loads((Path(__file__).parent / "fallback_links.json").read_text(encoding="utf-8"))
TAVILY_URL = "https://api.tavily.com/search"
OPENALEX_URL = "https://api.openalex.org/works"
YOUTUBE_URL = "https://www.googleapis.com/youtube/v3/search"
RESULTS_PER_SEARCH = 6
SNIPPET_LENGTH = 220
TIMEOUT_SECONDS = 15

router = APIRouter()


def provider_keys():
    return os.environ.get("TAVILY_API_KEY"), os.environ.get("YOUTUBE_API_KEY")


def short_snippet(text):
    text = " ".join((text or "").split())
    if len(text) <= SNIPPET_LENGTH:
        return text or "No description available."
    return text[:SNIPPET_LENGTH].rsplit(" ", 1)[0] + "…"


def normalize_tavily_items(items):
    return [{"title": item.get("title") or item.get("url"), "url": item.get("url"), "snippet": short_snippet(item.get("content")),
             "source": urllib.parse.urlsplit(item.get("url") or "").netloc.removeprefix("www.") or "Web",
             "displayUrl": item.get("url"), "type": "resource"} for item in items if item.get("url")]


def abstract_text(inverted_index):
    """OpenAlex stores each abstract as a map of word to positions, so put the words back in order."""
    positions = [(position, word) for word, places in (inverted_index or {}).items() for position in places]
    return " ".join(word for _, word in sorted(positions))


def normalize_openalex_items(items):
    papers = []
    for item in items:
        location = item.get("best_oa_location") or item.get("primary_location") or {}
        url = location.get("landing_page_url") or item.get("doi") or item.get("id")
        if not url:
            continue
        journal = (location.get("source") or {}).get("display_name") or "OpenAlex"
        year = item.get("publication_year")
        papers.append({"title": re.sub(r"<[^>]+>", "", item.get("title") or "Untitled paper"), "url": url,
                       "snippet": short_snippet(abstract_text(item.get("abstract_inverted_index"))),
                       "source": f"{journal}, {year}" if year else journal, "displayUrl": url, "type": "paper"})
    return papers


def normalize_youtube_items(items):
    videos = []
    for item in items:
        video_id = (item.get("id") or {}).get("videoId")
        if not video_id:
            continue
        snippet = item.get("snippet") or {}
        thumbnails = snippet.get("thumbnails") or {}
        thumbnail = next(((thumbnails.get(size) or {}).get("url") for size in ("high", "medium", "default")
                          if (thumbnails.get(size) or {}).get("url")), "")
        videos.append({"title": snippet.get("title") or "Untitled video", "url": f"https://www.youtube.com/watch?v={video_id}",
                       "snippet": snippet.get("description") or "No description available.",
                       "channelTitle": snippet.get("channelTitle") or "YouTube", "thumbnail": thumbnail,
                       "publishedAt": snippet.get("publishedAt") or "", "type": "video"})
    return videos


def matching_entry(catalog, topic):
    lowered = topic.lower()
    return next((entry for entry in catalog if any(keyword in lowered for keyword in entry["keywords"])), None)


def saved_links(topic, kind):
    entry = matching_entry(FALLBACKS["fallbackCatalog"], topic)
    items = entry["papers" if kind == "paper" else "resources"] if entry else FALLBACKS["genericFallbackItems"][kind]
    return [{**item, "displayUrl": item["url"], "type": kind} for item in items]


def youtube_fallback(topic):
    entry = matching_entry(FALLBACKS["fallbackVideoCatalog"], topic)
    if entry:
        videos = entry["videos"]
    else:
        wanted = urllib.parse.quote(topic, safe="-_.!~*'()").replace("%20", "+")
        videos = [{**video, "url": f"{video['url']}+{wanted}"} for video in FALLBACKS["genericFallbackVideos"]]
    return [{**video, "thumbnail": "", "publishedAt": "", "type": "video"} for video in videos]


async def fetch_provider(client, method, url, label, fallback_message, warnings, **request):
    """A provider failing only adds a warning, and the fallback links fill its place."""
    try:
        response = await client.request(method, url, **request)
        if response.is_success:
            return response.json()
        print(f"{label} provider error: status {response.status_code}")
    except (httpx.HTTPError, ValueError) as error:     # Not the error text: the URL can hold an API key.
        print(f"{label} provider error: {type(error).__name__}")
    warnings.append(fallback_message)
    return {}


async def search_resources(client, topic, tavily_key, warnings):
    message = "Web search is unavailable, so saved learning links are being shown."
    if not tavily_key:
        warnings.append(message)
        return {}
    return await fetch_provider(client, "POST", TAVILY_URL, "Resource", message, warnings,
                                headers={"Authorization": f"Bearer {tavily_key}"},
                                json={"query": f"{topic} best tutorials documentation guides", "max_results": RESULTS_PER_SEARCH})


@router.get("/api/site/health")
def site_health():
    tavily_key, youtube_key = provider_keys()
    return {"ok": True, "service": "manzil-ai", "youtubeConfigured": bool(youtube_key), "webSearchConfigured": bool(tavily_key)}


@router.get("/api/resources/search")
async def search(topic: str = ""):
    topic = topic.strip()
    if not topic:
        return JSONResponse({"message": "Topic is required."}, status_code=400)

    tavily_key, youtube_key = provider_keys()
    if not youtube_key:
        return JSONResponse({"message": "Search is not active yet. Add YOUTUBE_API_KEY to the .env file."}, status_code=503)

    video_params = {"key": youtube_key, "part": "snippet", "q": f"{topic} tutorial", "type": "video",
                    "maxResults": str(RESULTS_PER_SEARCH), "order": "relevance", "safeSearch": "strict", "videoEmbeddable": "true"}
    paper_params = {"search": topic, "per-page": str(RESULTS_PER_SEARCH), "filter": "is_oa:true",
                    "select": "id,doi,title,publication_year,best_oa_location,primary_location,abstract_inverted_index"}

    warnings = []
    # The system's trusted certificates, which the agent's own downloads use too.
    async with httpx.AsyncClient(timeout=TIMEOUT_SECONDS, verify=ssl.create_default_context()) as client:
        resource_data, paper_data, video_data = await asyncio.gather(
            search_resources(client, topic, tavily_key, warnings),
            fetch_provider(client, "GET", OPENALEX_URL, "Paper", "Paper search is unavailable, so saved paper links are being shown.",
                           warnings, params=paper_params),
            fetch_provider(client, "GET", YOUTUBE_URL, "Video", "YouTube video search is unavailable right now.", warnings,
                           params=video_params))

    resources = normalize_tavily_items(resource_data.get("results", [])) or saved_links(topic, "resource")
    papers = normalize_openalex_items(paper_data.get("results", [])) or saved_links(topic, "paper")
    videos = normalize_youtube_items(video_data.get("items", [])) or youtube_fallback(topic)

    return {"topic": topic, "resources": resources, "papers": papers, "videos": videos, "providerWarnings": warnings}
