const path = require("path");
const express = require("express");
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const dotenv = require("dotenv");

const User = require("./models/User");

dotenv.config();

const app = express();
const port = process.env.PORT || 3000;
const mongoUri = process.env.MONGODB_URI;
const jwtSecret = process.env.JWT_SECRET;
const googleSearchApiKey = process.env.GOOGLE_SEARCH_API_KEY;
const googleSearchEngineId = String(process.env.GOOGLE_SEARCH_ENGINE_ID || "").replace(/^cx=/i, "");
const youtubeApiKey = process.env.YOUTUBE_API_KEY;

if (!mongoUri) {
  throw new Error("MONGODB_URI is required. Add it to your .env file.");
}

if (!jwtSecret) {
  throw new Error("JWT_SECRET is required. Add it to your .env file.");
}

app.use(express.json());
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") {
    return res.sendStatus(204);
  }

  next();
});
app.use(express.static(path.join(__dirname), { index: false }));

const createToken = (user) =>
  jwt.sign(
    {
      userId: user._id.toString(),
      email: user.email,
    },
    jwtSecret,
    { expiresIn: "7d" }
  );

const authMiddleware = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization || "";
    const [scheme, token] = authHeader.split(" ");

    if (scheme !== "Bearer" || !token) {
      return res.status(401).json({ message: "Authorization required." });
    }

    const payload = jwt.verify(token, jwtSecret);
    const user = await User.findById(payload.userId).select("-passwordHash");

    if (!user) {
      return res.status(401).json({ message: "Invalid session." });
    }

    req.user = user;
    next();
  } catch (error) {
    return res.status(401).json({ message: "Invalid or expired token." });
  }
};

const safeTrim = (value) => String(value || "").trim();

const buildGoogleSearchUrl = (query, num = 6) => {
  const params = new URLSearchParams({
    key: googleSearchApiKey,
    cx: googleSearchEngineId,
    q: query,
    num: String(num),
    safe: "active",
  });

  return `https://www.googleapis.com/customsearch/v1?${params.toString()}`;
};

const buildYouTubeSearchUrl = (query, maxResults = 6) => {
  const params = new URLSearchParams({
    key: youtubeApiKey,
    part: "snippet",
    q: query,
    type: "video",
    maxResults: String(maxResults),
    order: "relevance",
    safeSearch: "strict",
    videoEmbeddable: "true",
  });

  return `https://www.googleapis.com/youtube/v3/search?${params.toString()}`;
};

const normalizeGoogleItems = (items = [], type) =>
  items.map((item) => ({
    title: item.title,
    url: item.link,
    snippet: item.snippet || "No description available.",
    source: item.displayLink || "Google Search",
    displayUrl: item.formattedUrl || item.link,
    type,
  }));

const normalizeYouTubeItems = (items = []) =>
  items
    .filter((item) => item.id?.videoId)
    .map((item) => ({
      title: item.snippet?.title || "Untitled video",
      url: `https://www.youtube.com/watch?v=${item.id.videoId}`,
      snippet: item.snippet?.description || "No description available.",
      channelTitle: item.snippet?.channelTitle || "YouTube",
      thumbnail:
        item.snippet?.thumbnails?.high?.url ||
        item.snippet?.thumbnails?.medium?.url ||
        item.snippet?.thumbnails?.default?.url ||
        "",
      publishedAt: item.snippet?.publishedAt || "",
      type: "video",
    }));

const fallbackCatalog = [
  {
    keywords: ["machine learning", "ml", "ai", "artificial intelligence"],
    resources: [
      {
        title: "Machine Learning for Beginners",
        url: "https://microsoft.github.io/ML-For-Beginners/",
        snippet: "A structured Microsoft curriculum with lessons, labs, and beginner projects for machine learning.",
        source: "microsoft.github.io",
      },
      {
        title: "Google Machine Learning Crash Course",
        url: "https://developers.google.com/machine-learning/crash-course",
        snippet: "Google's practical course covering ML concepts, models, and hands-on exercises.",
        source: "developers.google.com",
      },
      {
        title: "Scikit-learn User Guide",
        url: "https://scikit-learn.org/stable/user_guide.html",
        snippet: "Official documentation for core machine-learning workflows in Python.",
        source: "scikit-learn.org",
      },
      {
        title: "Kaggle Intro to Machine Learning",
        url: "https://www.kaggle.com/learn/intro-to-machine-learning",
        snippet: "Short practical lessons for building and validating your first ML models.",
        source: "kaggle.com",
      },
      {
        title: "TensorFlow Tutorials",
        url: "https://www.tensorflow.org/tutorials",
        snippet: "Official TensorFlow guides and notebooks for model building and deployment.",
        source: "tensorflow.org",
      },
      {
        title: "freeCodeCamp Machine Learning with Python",
        url: "https://www.freecodecamp.org/learn/machine-learning-with-python/",
        snippet: "Project-based machine-learning lessons using Python.",
        source: "freecodecamp.org",
      },
    ],
    papers: [
      {
        title: "Deep Learning Book",
        url: "https://www.deeplearningbook.org/",
        snippet: "A free online textbook covering neural networks and deep learning foundations.",
        source: "deeplearningbook.org",
      },
      {
        title: "Attention Is All You Need",
        url: "https://arxiv.org/abs/1706.03762",
        snippet: "The Transformer paper that shaped modern deep-learning systems.",
        source: "arxiv.org",
      },
      {
        title: "Scikit-learn: Machine Learning in Python",
        url: "https://jmlr.org/papers/v12/pedregosa11a.html",
        snippet: "The JMLR paper introducing the scikit-learn library.",
        source: "jmlr.org",
      },
    ],
  },
  {
    keywords: ["web development", "html", "css", "javascript", "frontend", "front end"],
    resources: [
      {
        title: "MDN Learn Web Development",
        url: "https://developer.mozilla.org/en-US/docs/Learn",
        snippet: "Mozilla's complete learning path for HTML, CSS, JavaScript, and web fundamentals.",
        source: "developer.mozilla.org",
      },
      {
        title: "The Odin Project",
        url: "https://www.theodinproject.com/paths",
        snippet: "A full-stack web-development curriculum with projects and structured paths.",
        source: "theodinproject.com",
      },
      {
        title: "web.dev Learn",
        url: "https://web.dev/learn",
        snippet: "Google's lessons on modern web development, performance, accessibility, and CSS.",
        source: "web.dev",
      },
      {
        title: "freeCodeCamp Responsive Web Design",
        url: "https://www.freecodecamp.org/learn/2022/responsive-web-design/",
        snippet: "Hands-on HTML and CSS projects for building responsive websites.",
        source: "freecodecamp.org",
      },
      {
        title: "JavaScript.info",
        url: "https://javascript.info/",
        snippet: "A deep, readable JavaScript guide from fundamentals to advanced browser topics.",
        source: "javascript.info",
      },
      {
        title: "React Learn",
        url: "https://react.dev/learn",
        snippet: "The official React learning path for components, state, and application structure.",
        source: "react.dev",
      },
    ],
    papers: [
      {
        title: "Design Principles for the Web Architecture",
        url: "https://www.w3.org/TR/webarch/",
        snippet: "A W3C technical report explaining core web architecture principles.",
        source: "w3.org",
      },
      {
        title: "HTML Design Principles",
        url: "https://www.w3.org/TR/html-design-principles/",
        snippet: "W3C guidance behind many design decisions in HTML.",
        source: "w3.org",
      },
      {
        title: "The JavaScript Memory Model",
        url: "https://tc39.es/ecma262/multipage/memory-model.html",
        snippet: "The ECMAScript specification section for JavaScript shared-memory behavior.",
        source: "tc39.es",
      },
    ],
  },
  {
    keywords: ["dsa", "data structures", "algorithms"],
    resources: [
      {
        title: "VisuAlgo",
        url: "https://visualgo.net/en",
        snippet: "Interactive visualizations for data structures and algorithms.",
        source: "visualgo.net",
      },
      {
        title: "CP-Algorithms",
        url: "https://cp-algorithms.com/",
        snippet: "A practical reference for algorithms, data structures, and competitive programming.",
        source: "cp-algorithms.com",
      },
      {
        title: "Open Data Structures",
        url: "https://opendatastructures.org/",
        snippet: "A free textbook with implementations and explanations for common data structures.",
        source: "opendatastructures.org",
      },
      {
        title: "LeetCode Explore",
        url: "https://leetcode.com/explore/",
        snippet: "Topic-based practice tracks for common coding interview patterns.",
        source: "leetcode.com",
      },
      {
        title: "HackerRank Data Structures",
        url: "https://www.hackerrank.com/domains/data-structures",
        snippet: "Practice problems grouped by data-structure topic.",
        source: "hackerrank.com",
      },
      {
        title: "GeeksforGeeks Data Structures",
        url: "https://www.geeksforgeeks.org/data-structures/",
        snippet: "Reference articles and examples for common data structures.",
        source: "geeksforgeeks.org",
      },
    ],
    papers: [
      {
        title: "Introduction to Algorithms Lectures",
        url: "https://ocw.mit.edu/courses/6-006-introduction-to-algorithms-spring-2020/",
        snippet: "MIT OpenCourseWare lectures, notes, and assignments for algorithms.",
        source: "ocw.mit.edu",
      },
      {
        title: "Open Data Structures Textbook",
        url: "https://opendatastructures.org/ods-python.pdf",
        snippet: "A freely available PDF textbook on data structures.",
        source: "opendatastructures.org",
      },
      {
        title: "Algorithms, Fourth Edition",
        url: "https://algs4.cs.princeton.edu/home/",
        snippet: "Princeton's book site with algorithms explanations, code, and resources.",
        source: "algs4.cs.princeton.edu",
      },
    ],
  },
  {
    keywords: ["cybersecurity", "cyber security", "security", "ethical hacking"],
    resources: [
      {
        title: "PortSwigger Web Security Academy",
        url: "https://portswigger.net/web-security",
        snippet: "Free hands-on labs and explanations for web application security.",
        source: "portswigger.net",
      },
      {
        title: "OWASP Web Security Testing Guide",
        url: "https://owasp.org/www-project-web-security-testing-guide/",
        snippet: "OWASP's guide for testing and understanding web security issues.",
        source: "owasp.org",
      },
      {
        title: "TryHackMe Learning Paths",
        url: "https://tryhackme.com/paths",
        snippet: "Guided cybersecurity practice paths for beginners and specialists.",
        source: "tryhackme.com",
      },
      {
        title: "Hack The Box Academy",
        url: "https://academy.hackthebox.com/",
        snippet: "Practical cybersecurity modules and labs.",
        source: "academy.hackthebox.com",
      },
      {
        title: "Cybrary Catalog",
        url: "https://www.cybrary.it/catalog",
        snippet: "Cybersecurity courses covering core concepts, defensive skills, and certifications.",
        source: "cybrary.it",
      },
      {
        title: "NIST Cybersecurity Framework",
        url: "https://www.nist.gov/cyberframework",
        snippet: "Official NIST cybersecurity framework resources.",
        source: "nist.gov",
      },
    ],
    papers: [
      {
        title: "OWASP Top Ten",
        url: "https://owasp.org/www-project-top-ten/",
        snippet: "OWASP's standard awareness document for critical web application security risks.",
        source: "owasp.org",
      },
      {
        title: "NIST SP 800-53",
        url: "https://csrc.nist.gov/publications/detail/sp/800-53/rev-5/final",
        snippet: "NIST security and privacy controls for information systems.",
        source: "csrc.nist.gov",
      },
      {
        title: "The Web Application Hacker's Handbook Resources",
        url: "https://portswigger.net/web-security/web-application-hackers-handbook",
        snippet: "Companion resources for learning web application security testing.",
        source: "portswigger.net",
      },
    ],
  },
];

const genericFallbackItems = {
  resource: [
    {
      title: "roadmap.sh Developer Roadmaps",
      url: "https://roadmap.sh/",
      snippet: "Visual learning roadmaps for common software and technology topics.",
      source: "roadmap.sh",
    },
    {
      title: "freeCodeCamp Learn",
      url: "https://www.freecodecamp.org/learn/",
      snippet: "Free interactive courses and projects across programming, data, and web topics.",
      source: "freecodecamp.org",
    },
    {
      title: "MDN Learning Area",
      url: "https://developer.mozilla.org/en-US/docs/Learn",
      snippet: "A direct learning hub for web fundamentals and programming concepts.",
      source: "developer.mozilla.org",
    },
    {
      title: "Kaggle Learn",
      url: "https://www.kaggle.com/learn",
      snippet: "Short practical courses for data, Python, and machine-learning skills.",
      source: "kaggle.com",
    },
    {
      title: "MIT OpenCourseWare",
      url: "https://ocw.mit.edu/",
      snippet: "Free university-level course materials across computer science, math, and engineering.",
      source: "ocw.mit.edu",
    },
    {
      title: "GeeksforGeeks Tutorials",
      url: "https://www.geeksforgeeks.org/computer-science-projects/",
      snippet: "Project and tutorial collections for computer-science learners.",
      source: "geeksforgeeks.org",
    },
  ],
  paper: [
    {
      title: "Papers With Code",
      url: "https://paperswithcode.com/",
      snippet: "Research papers connected with code, datasets, and benchmarks.",
      source: "paperswithcode.com",
    },
    {
      title: "arXiv Computer Science",
      url: "https://arxiv.org/archive/cs",
      snippet: "Computer-science preprint categories for deeper technical reading.",
      source: "arxiv.org",
    },
    {
      title: "ACM Digital Library",
      url: "https://dl.acm.org/",
      snippet: "A direct portal for computing research publications.",
      source: "dl.acm.org",
    },
  ],
};

const fallbackVideoCatalog = [
  {
    keywords: ["machine learning", "ml", "ai", "artificial intelligence"],
    videos: [
      {
        title: "Machine Learning Full Course",
        url: "https://www.youtube.com/results?search_query=machine+learning+full+course+for+beginners",
        snippet: "Open YouTube results for beginner-friendly full machine-learning courses.",
        channelTitle: "YouTube",
      },
      {
        title: "Machine Learning Crash Course Videos",
        url: "https://www.youtube.com/results?search_query=machine+learning+crash+course",
        snippet: "Find crash-course style walkthroughs for core ML concepts.",
        channelTitle: "YouTube",
      },
      {
        title: "Python Machine Learning Tutorials",
        url: "https://www.youtube.com/results?search_query=python+machine+learning+tutorial",
        snippet: "Open practical Python ML tutorials and projects.",
        channelTitle: "YouTube",
      },
    ],
  },
  {
    keywords: ["web development", "html", "css", "javascript", "frontend", "front end"],
    videos: [
      {
        title: "Web Development Full Course",
        url: "https://www.youtube.com/results?search_query=web+development+full+course+for+beginners",
        snippet: "Open YouTube results for complete beginner web-development courses.",
        channelTitle: "YouTube",
      },
      {
        title: "HTML CSS JavaScript Tutorial",
        url: "https://www.youtube.com/results?search_query=html+css+javascript+tutorial+for+beginners",
        snippet: "Find guided HTML, CSS, and JavaScript walkthroughs.",
        channelTitle: "YouTube",
      },
      {
        title: "Frontend Project Tutorials",
        url: "https://www.youtube.com/results?search_query=frontend+projects+html+css+javascript",
        snippet: "Open project-based frontend tutorials on YouTube.",
        channelTitle: "YouTube",
      },
    ],
  },
  {
    keywords: ["dsa", "data structures", "algorithms"],
    videos: [
      {
        title: "Data Structures and Algorithms Full Course",
        url: "https://www.youtube.com/results?search_query=data+structures+and+algorithms+full+course",
        snippet: "Open YouTube results for full DSA courses.",
        channelTitle: "YouTube",
      },
      {
        title: "DSA Roadmap and Interview Prep",
        url: "https://www.youtube.com/results?search_query=dsa+roadmap+interview+preparation",
        snippet: "Find DSA roadmap and interview-preparation videos.",
        channelTitle: "YouTube",
      },
      {
        title: "Algorithms Visualized",
        url: "https://www.youtube.com/results?search_query=algorithms+visualized+data+structures",
        snippet: "Open visual explanations for algorithms and data structures.",
        channelTitle: "YouTube",
      },
    ],
  },
  {
    keywords: ["cybersecurity", "cyber security", "security", "ethical hacking"],
    videos: [
      {
        title: "Cybersecurity Full Course",
        url: "https://www.youtube.com/results?search_query=cybersecurity+full+course+for+beginners",
        snippet: "Open beginner-friendly cybersecurity courses on YouTube.",
        channelTitle: "YouTube",
      },
      {
        title: "Ethical Hacking Tutorial",
        url: "https://www.youtube.com/results?search_query=ethical+hacking+tutorial+for+beginners",
        snippet: "Find practical ethical-hacking walkthroughs.",
        channelTitle: "YouTube",
      },
      {
        title: "Web Security Labs",
        url: "https://www.youtube.com/results?search_query=web+security+owasp+tutorial",
        snippet: "Open OWASP and web-security learning videos.",
        channelTitle: "YouTube",
      },
    ],
  },
];

const genericFallbackVideos = [
  {
    title: "Beginner Full Course Videos",
    url: "https://www.youtube.com/results?search_query=beginner+full+course+tutorial",
    snippet: "Open YouTube results for complete beginner courses.",
    channelTitle: "YouTube",
  },
  {
    title: "Project Based Tutorials",
    url: "https://www.youtube.com/results?search_query=project+based+tutorial+for+beginners",
    snippet: "Find hands-on project tutorials for learning by building.",
    channelTitle: "YouTube",
  },
  {
    title: "Roadmap and Learning Path Videos",
    url: "https://www.youtube.com/results?search_query=roadmap+learning+path+tutorial",
    snippet: "Open roadmap videos and structured learning plans.",
    channelTitle: "YouTube",
  },
];

const buildGoogleFallbackItems = (topic, type) => {
  const normalizedTopic = topic.toLowerCase();
  const matchedCatalog = fallbackCatalog.find((entry) =>
    entry.keywords.some((keyword) => normalizedTopic.includes(keyword))
  );

  const fallbackConfig = matchedCatalog
    ? matchedCatalog[type === "paper" ? "papers" : "resources"]
    : genericFallbackItems[type === "paper" ? "paper" : "resource"];

  return fallbackConfig.map((item) => ({
    ...item,
    displayUrl: item.url,
    type,
  }));
};

const buildYouTubeFallbackItems = (topic) => {
  const normalizedTopic = topic.toLowerCase();
  const matchedCatalog = fallbackVideoCatalog.find((entry) =>
    entry.keywords.some((keyword) => normalizedTopic.includes(keyword))
  );

  const fallbackConfig = matchedCatalog
    ? matchedCatalog.videos
    : genericFallbackVideos.map((item) => ({
        ...item,
        url: `${item.url}+${encodeURIComponent(topic).replace(/%20/g, "+")}`,
      }));

  return fallbackConfig.map((item) => ({
    ...item,
    thumbnail: "",
    publishedAt: "",
    type: "video",
  }));
};

const parseProviderError = async (response) => {
  try {
    return await response.text();
  } catch (error) {
    return "Unknown provider error.";
  }
};

const fetchProviderData = async (url, label, fallbackMessage, providerWarnings) => {
  try {
    const response = await fetch(url);

    if (response.ok) {
      return await response.json();
    }

    const detail = await parseProviderError(response);
    console.error(`${label} provider error:`, detail);
  } catch (error) {
    console.error(`${label} provider error:`, error);
  }

  providerWarnings.push(fallbackMessage);
  return {};
};

app.post("/api/auth/register", async (req, res) => {
  try {
    const { firstName, lastName, email, password, confirmPassword } = req.body;

    if (!firstName || !lastName || !email || !password || !confirmPassword) {
      return res.status(400).json({ message: "All fields are required." });
    }

    if (password.length < 6) {
      return res.status(400).json({ message: "Password must be at least 6 characters." });
    }

    if (password !== confirmPassword) {
      return res.status(400).json({ message: "Passwords do not match." });
    }

    const normalizedEmail = email.trim().toLowerCase();
    const existingUser = await User.findOne({ email: normalizedEmail });

    if (existingUser) {
      return res.status(409).json({ message: "An account with this email already exists." });
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const user = await User.create({
      firstName: firstName.trim(),
      lastName: lastName.trim(),
      email: normalizedEmail,
      passwordHash,
    });

    const token = createToken(user);

    return res.status(201).json({
      message: "Account created successfully.",
      token,
      user: {
        id: user._id,
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email,
      },
    });
  } catch (error) {
    console.error("Register error:", error);
    return res.status(500).json({ message: "Unable to register right now." });
  }
});

app.post("/api/auth/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ message: "Email and password are required." });
    }

    const normalizedEmail = email.trim().toLowerCase();
    const user = await User.findOne({ email: normalizedEmail });

    if (!user) {
      return res.status(401).json({ message: "Invalid email or password." });
    }

    const passwordMatches = await bcrypt.compare(password, user.passwordHash);

    if (!passwordMatches) {
      return res.status(401).json({ message: "Invalid email or password." });
    }

    const token = createToken(user);

    return res.json({
      message: "Login successful.",
      token,
      user: {
        id: user._id,
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email,
      },
    });
  } catch (error) {
    console.error("Login error:", error);
    return res.status(500).json({ message: "Unable to log in right now." });
  }
});

app.get("/api/auth/me", authMiddleware, (req, res) => {
  return res.json({ user: req.user });
});

app.get("/api/health", (req, res) => {
  return res.json({
    ok: true,
    service: "manzil-backend",
    youtubeConfigured: Boolean(youtubeApiKey),
    googleConfigured: Boolean(googleSearchApiKey && googleSearchEngineId),
  });
});

app.get("/api/resources/search", async (req, res) => {
  try {
    const topic = safeTrim(req.query.topic);

    if (!topic) {
      return res.status(400).json({ message: "Topic is required." });
    }

    if (!googleSearchApiKey || !googleSearchEngineId || !youtubeApiKey) {
      return res.status(503).json({
        message:
          "Search is not active yet. Add GOOGLE_SEARCH_API_KEY, GOOGLE_SEARCH_ENGINE_ID, and YOUTUBE_API_KEY to the .env file.",
      });
    }

    const resourceQuery = `${topic} best tutorials documentation guides`;
    const paperQuery = `${topic} research papers site:arxiv.org OR site:scholar.google.com OR filetype:pdf`;
    const videoQuery = `${topic} tutorial`;

    const providerWarnings = [];
    const [resourceData, paperData, videoData] = await Promise.all([
      fetchProviderData(
        buildGoogleSearchUrl(resourceQuery, 6),
        "Resource",
        "Google resource search is unavailable for this API project, so fallback learning links are being shown.",
        providerWarnings
      ),
      fetchProviderData(
        buildGoogleSearchUrl(paperQuery, 6),
        "Paper",
        "Google paper search is unavailable for this API project, so fallback paper links are being shown.",
        providerWarnings
      ),
      fetchProviderData(
        buildYouTubeSearchUrl(videoQuery, 6),
        "Video",
        "YouTube video search is unavailable right now.",
        providerWarnings
      ),
    ]);

    const resources = normalizeGoogleItems(resourceData.items, "resource");
    const papers = normalizeGoogleItems(paperData.items, "paper");
    const videos = normalizeYouTubeItems(videoData.items);
    const resolvedResources = resources.length ? resources : buildGoogleFallbackItems(topic, "resource");
    const resolvedPapers = papers.length ? papers : buildGoogleFallbackItems(topic, "paper");
    const resolvedVideos = videos.length ? videos : buildYouTubeFallbackItems(topic);

    if (!resolvedResources.length && !resolvedPapers.length && !resolvedVideos.length) {
      return res.status(502).json({
        message: "No providers returned results. Check your API keys and enabled APIs.",
        providerWarnings,
      });
    }

    return res.json({
      topic,
      resources: resolvedResources,
      papers: resolvedPapers,
      videos: resolvedVideos,
      providerWarnings,
      meta: {
        totalResources: resourceData.searchInformation?.formattedTotalResults || String(resolvedResources.length),
        totalPapers: paperData.searchInformation?.formattedTotalResults || String(resolvedPapers.length),
        totalVideos: Array.isArray(videoData.items) ? String(videoData.items.length) : String(resolvedVideos.length),
      },
    });
  } catch (error) {
    console.error("Resource search error:", error);
    return res.status(500).json({ message: "Unable to fetch learning resources right now." });
  }
});

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "login.html"));
});

app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "login.html"));
});

const startServer = async () => {
  try {
    await mongoose.connect(mongoUri, {
      serverSelectionTimeoutMS: 5000,
    });
    console.log("MongoDB connected.");
    await new Promise((resolve, reject) => {
      const server = app.listen(port, () => {
        console.log(`Server running at http://localhost:${port}`);
        resolve();
      });

      server.on("error", reject);
    });
  } catch (error) {
    if (error.code === "EADDRINUSE") {
      console.error(`Startup error: port ${port} is already in use.`);
      console.error(`Open http://localhost:${port}/api/health to check the running backend, or set PORT to a free port in .env.`);
    } else {
      console.error("Startup error:", error.message);
      console.error("Check MONGODB_URI in .env and make sure MongoDB is running before starting the app.");
    }
    process.exit(1);
  }
};

startServer();
