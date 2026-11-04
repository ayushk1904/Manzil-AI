"""The Resource Hub's search: Google for resources and papers, YouTube for videos, saved links as a fallback."""
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
GOOGLE_URL = "https://www.googleapis.com/customsearch/v1"
YOUTUBE_URL = "https://www.googleapis.com/youtube/v3/search"
RESULTS_PER_SEARCH = 6
TIMEOUT_SECONDS = 15

router = APIRouter()


def provider_keys():
    return (os.environ.get("GOOGLE_SEARCH_API_KEY"),
            re.sub(r"^cx=", "", os.environ.get("GOOGLE_SEARCH_ENGINE_ID", ""), flags=re.IGNORECASE),
            os.environ.get("YOUTUBE_API_KEY"))


def normalize_google_items(items, kind):
    return [{"title": item.get("title"), "url": item.get("link"), "snippet": item.get("snippet") or "No description available.",
             "source": item.get("displayLink") or "Google Search", "displayUrl": item.get("formattedUrl") or item.get("link"),
             "type": kind} for item in items]


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


def google_fallback(topic, kind):
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


async def fetch_provider(client, url, params, label, fallback_message, warnings):
    """A provider failing only adds a warning, and the fallback links fill its place."""
    try:
        response = await client.get(url, params=params)
        if response.is_success:
            return response.json()
        print(f"{label} provider error: status {response.status_code}")
    except (httpx.HTTPError, ValueError) as error:     # Not the error text: the URL holds the API key.
        print(f"{label} provider error: {type(error).__name__}")
    warnings.append(fallback_message)
    return {}


@router.get("/api/site/health")
def site_health():
    google_key, engine_id, youtube_key = provider_keys()
    return {"ok": True, "service": "manzil-ai", "youtubeConfigured": bool(youtube_key),
            "googleConfigured": bool(google_key and engine_id)}


@router.get("/api/resources/search")
async def search(topic: str = ""):
    topic = topic.strip()
    if not topic:
        return JSONResponse({"message": "Topic is required."}, status_code=400)

    google_key, engine_id, youtube_key = provider_keys()
    if not (google_key and engine_id and youtube_key):
        return JSONResponse({"message": "Search is not active yet. Add GOOGLE_SEARCH_API_KEY, GOOGLE_SEARCH_ENGINE_ID, "
                                        "and YOUTUBE_API_KEY to the .env file."}, status_code=503)

    def google_params(query):
        return {"key": google_key, "cx": engine_id, "q": query, "num": str(RESULTS_PER_SEARCH), "safe": "active"}

    video_params = {"key": youtube_key, "part": "snippet", "q": f"{topic} tutorial", "type": "video",
                    "maxResults": str(RESULTS_PER_SEARCH), "order": "relevance", "safeSearch": "strict", "videoEmbeddable": "true"}
    resource_query = f"{topic} best tutorials documentation guides"
    paper_query = f"{topic} research papers site:arxiv.org OR site:scholar.google.com OR filetype:pdf"

    warnings = []
    # The system's trusted certificates, which the agent's own downloads use too.
    async with httpx.AsyncClient(timeout=TIMEOUT_SECONDS, verify=ssl.create_default_context()) as client:
        resource_data, paper_data, video_data = await asyncio.gather(
            fetch_provider(client, GOOGLE_URL, google_params(resource_query), "Resource",
                           "Google resource search is unavailable for this API project, so fallback learning links are being shown.", warnings),
            fetch_provider(client, GOOGLE_URL, google_params(paper_query), "Paper",
                           "Google paper search is unavailable for this API project, so fallback paper links are being shown.", warnings),
            fetch_provider(client, YOUTUBE_URL, video_params, "Video",
                           "YouTube video search is unavailable right now.", warnings))

    resources = normalize_google_items(resource_data.get("items", []), "resource") or google_fallback(topic, "resource")
    papers = normalize_google_items(paper_data.get("items", []), "paper") or google_fallback(topic, "paper")
    videos = normalize_youtube_items(video_data.get("items", [])) or youtube_fallback(topic)

    return {"topic": topic, "resources": resources, "papers": papers, "videos": videos, "providerWarnings": warnings,
            "meta": {"totalResources": resource_data.get("searchInformation", {}).get("formattedTotalResults") or str(len(resources)),
                     "totalPapers": paper_data.get("searchInformation", {}).get("formattedTotalResults") or str(len(papers)),
                     "totalVideos": str(len(video_data["items"])) if isinstance(video_data.get("items"), list) else str(len(videos))}}
