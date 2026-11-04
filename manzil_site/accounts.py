"""Register, log in and check a session. Same users collection and tokens as the old Express app.

MongoDB being down only stops these routes. The agent has no database and keeps working.
"""
import datetime
import os
from functools import cache

import bcrypt
import jwt
from bson import ObjectId
from bson.errors import InvalidId
from fastapi import APIRouter, Body, Header
from fastapi.responses import JSONResponse
from pymongo import MongoClient
from pymongo.errors import ConfigurationError, DuplicateKeyError, PyMongoError

BCRYPT_ROUNDS = 12
BCRYPT_MAX_BYTES = 72                     # bcryptjs cut longer passwords here, so existing hashes need the same.
TOKEN_DAYS = 7
MONGO_TIMEOUT_MS = 5000
ALGORITHM = "HS256"

router = APIRouter(prefix="/api/auth")


class NotConfigured(Exception):
    """MONGODB_URI or JWT_SECRET is missing, or the URI names no database."""


def message(status, text):
    return JSONResponse({"message": text}, status_code=status)


def jwt_secret():
    secret = os.environ.get("JWT_SECRET")
    if not secret:
        raise NotConfigured("JWT_SECRET is required. Add it to your .env file.")
    return secret


@cache
def _users_collection(uri):
    try:
        database = MongoClient(uri, serverSelectionTimeoutMS=MONGO_TIMEOUT_MS).get_default_database()
    except ConfigurationError as error:     # Without a name, the driver's default could be another app's data.
        raise NotConfigured("MONGODB_URI must end with a database name.") from error
    users = database["users"]
    users.create_index("email", unique=True)  # The index Mongoose created. Does nothing if it already exists.
    return users


def users_collection():
    uri = os.environ.get("MONGODB_URI")
    if not uri:
        raise NotConfigured("MONGODB_URI is required. Add it to your .env file.")
    return _users_collection(uri)


def hash_password(password):
    return bcrypt.hashpw(password.encode()[:BCRYPT_MAX_BYTES], bcrypt.gensalt(BCRYPT_ROUNDS)).decode()


def password_matches(password, password_hash):
    return bcrypt.checkpw(password.encode()[:BCRYPT_MAX_BYTES], password_hash.encode())


def create_token(user):
    now = datetime.datetime.now(datetime.UTC)
    return jwt.encode({"userId": str(user["_id"]), "email": user["email"], "iat": now,
                       "exp": now + datetime.timedelta(days=TOKEN_DAYS)}, jwt_secret(), algorithm=ALGORITHM)


def public_user(user):
    return {"id": str(user["_id"]), "firstName": user["firstName"], "lastName": user["lastName"], "email": user["email"]}


def iso_date(value):
    """The same date format Express sent."""
    return f"{value.strftime('%Y-%m-%dT%H:%M:%S')}.{value.microsecond // 1000:03d}Z"


def session_user(user):
    """What /me has always returned: the stored user without the password hash."""
    shown = {key: value for key, value in user.items() if key != "passwordHash"}
    shown["_id"] = str(user["_id"])
    for field in ("createdAt", "updatedAt"):
        if isinstance(shown.get(field), datetime.datetime):
            shown[field] = iso_date(shown[field])
    return shown


def text_field(body, name):
    value = body.get(name)
    return value if isinstance(value, str) else ""


def unavailable(error, action):
    print(f"{action} error: {type(error).__name__}")       # Not the error text: it could include the URI.
    if isinstance(error, NotConfigured):
        return message(503, str(error))
    return message(503, "Accounts are unavailable right now. Please try again soon.")


@router.post("/register")
def register(body: dict = Body(default={})):
    first_name, last_name = text_field(body, "firstName"), text_field(body, "lastName")
    email, password = text_field(body, "email"), text_field(body, "password")
    confirm_password = text_field(body, "confirmPassword")
    if not (first_name and last_name and email and password and confirm_password):
        return message(400, "All fields are required.")
    if len(password) < 6:
        return message(400, "Password must be at least 6 characters.")
    if password != confirm_password:
        return message(400, "Passwords do not match.")

    normalized_email = email.strip().lower()
    try:
        users = users_collection()
        if users.find_one({"email": normalized_email}):
            return message(409, "An account with this email already exists.")
        now = datetime.datetime.now(datetime.UTC)
        user = {"firstName": first_name.strip(), "lastName": last_name.strip(), "email": normalized_email,
                "passwordHash": hash_password(password), "createdAt": now, "updatedAt": now, "__v": 0}
        users.insert_one(user)
        return JSONResponse({"message": "Account created successfully.", "token": create_token(user),
                             "user": public_user(user)}, status_code=201)
    except DuplicateKeyError:                # Two requests at once: the index caught the second.
        return message(409, "An account with this email already exists.")
    except (NotConfigured, PyMongoError) as error:
        return unavailable(error, "Register")


@router.post("/login")
def login(body: dict = Body(default={})):
    email, password = text_field(body, "email"), text_field(body, "password")
    if not email or not password:
        return message(400, "Email and password are required.")
    try:
        user = users_collection().find_one({"email": email.strip().lower()})
        if not user or not password_matches(password, user["passwordHash"]):
            return message(401, "Invalid email or password.")
        return {"message": "Login successful.", "token": create_token(user), "user": public_user(user)}
    except (NotConfigured, PyMongoError) as error:
        return unavailable(error, "Login")


@router.get("/me")
def me(authorization: str = Header(default="")):
    scheme, _, token = authorization.partition(" ")
    if scheme != "Bearer" or not token:
        return message(401, "Authorization required.")
    try:
        payload = jwt.decode(token, jwt_secret(), algorithms=[ALGORITHM])
        user = users_collection().find_one({"_id": ObjectId(payload["userId"])})
    except (jwt.PyJWTError, InvalidId, KeyError, TypeError):
        return message(401, "Invalid or expired token.")
    except (NotConfigured, PyMongoError) as error:
        return unavailable(error, "Session")
    if not user:
        return message(401, "Invalid session.")
    return {"user": session_user(user)}
