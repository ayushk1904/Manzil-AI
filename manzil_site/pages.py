"""The Resource Hub page, and redirects so old Manzil.com links still arrive somewhere useful."""
from pathlib import Path

from fastapi import APIRouter
from fastapi.responses import FileResponse, RedirectResponse

PAGES = Path(__file__).parent / "pages"
OLD_ADDRESSES = {
    "/dashboard.html": "/resources",
    "/index.html": "/resources",
    "/about.html": "/resources",
    "/about": "/resources",
    "/login": "/resources",
    "/login.html": "/resources",
    "/register": "/resources",
    "/register.html": "/resources",
    "/account": "/resources",
    "/account.html": "/resources",
}

router = APIRouter()


@router.get("/resources", include_in_schema=False)
def resources():
    return FileResponse(PAGES / "resources.html", media_type="text/html")


def add_redirect(old, new):
    def redirect():
        return RedirectResponse(new)
    router.add_api_route(old, redirect, methods=["GET"], include_in_schema=False)


for old, new in OLD_ADDRESSES.items():
    add_redirect(old, new)
