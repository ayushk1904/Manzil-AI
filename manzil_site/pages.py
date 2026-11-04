"""The site's pages, and redirects so old Manzil.com links still arrive somewhere useful."""
from pathlib import Path

from fastapi import APIRouter, Request
from fastapi.responses import FileResponse, RedirectResponse

PAGES = Path(__file__).parent / "pages"
OLD_ADDRESSES = {
    "/dashboard.html": "/resources",
    "/index.html": "/resources#guide",
    "/about.html": "/resources#about",
    "/about": "/resources#about",
    "/login.html": "/login",
    "/register.html": "/register",
    "/account.html": "/account",
}

router = APIRouter()


def add_page(address, filename):
    def page():
        return FileResponse(PAGES / filename, media_type="text/html")
    router.add_api_route(address, page, methods=["GET"], include_in_schema=False)


def add_redirect(old, new):
    def redirect(request: Request):
        path, hash_mark, section = new.partition("#")
        query = f"?{request.url.query}" if request.url.query else ""
        return RedirectResponse(f"{path}{query}{hash_mark}{section}")
    router.add_api_route(old, redirect, methods=["GET"], include_in_schema=False)


for address, filename in (("/resources", "resources.html"), ("/login", "login.html"),
                          ("/register", "register.html"), ("/account", "account.html")):
    add_page(address, filename)
for old, new in OLD_ADDRESSES.items():
    add_redirect(old, new)
