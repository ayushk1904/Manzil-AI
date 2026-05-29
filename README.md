# Manzil.com

Manzil.com is a learning resource dashboard with login/register authentication, MongoDB user storage, and live learning-resource search.

## Tech Stack

- HTML, CSS, and vanilla JavaScript frontend
- Node.js and Express backend
- MongoDB with Mongoose
- JWT authentication

## Local Setup

1. Install dependencies:

```bash
npm install
```

2. Create `.env` from `.env.example` and fill in real values:

```env
PORT=3000
MONGODB_URI=mongodb://127.0.0.1:27017/manzil_auth
JWT_SECRET=replace-with-a-long-random-secret
GOOGLE_SEARCH_API_KEY=your-google-api-key
GOOGLE_SEARCH_ENGINE_ID=your-programmable-search-engine-id
YOUTUBE_API_KEY=your-youtube-api-key
```

3. Start MongoDB locally, then run:

```bash
npm start
```

4. Open:

```text
http://localhost:3000
```

The app starts at Login/Register. Home, About, Dashboard, and Account require authentication.

## GitHub Deployment Notes

This project should be pushed to GitHub as a Node app repository. Do not commit `.env`; use environment variables in your hosting dashboard.

GitHub Pages can only host the static frontend, so it will not run login/register, MongoDB, or resource-search APIs. For the full app, deploy the GitHub repository to a Node host such as Render, Railway, or Fly.io.

Required production environment variables:

```env
MONGODB_URI=
JWT_SECRET=
GOOGLE_SEARCH_API_KEY=
GOOGLE_SEARCH_ENGINE_ID=
YOUTUBE_API_KEY=
```

Use MongoDB Atlas for production instead of local MongoDB.
