const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');


// Helper to find the research reports memory directory dynamically
function findMemoryDir() {
  if (process.env.LAST30DAYS_MEMORY_DIR) {
    return path.resolve(process.env.LAST30DAYS_MEMORY_DIR);
  }

  const home = process.env.HOME || '/home/lazorr';
  const configPath = path.join(home, '.config/last30days/.env');
  
  if (fs.existsSync(configPath)) {
    try {
      const content = fs.readFileSync(configPath, 'utf-8');
      const lines = content.split('\n');
      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.startsWith('#') || !trimmed) continue;
        if (trimmed.includes('=')) {
          const [key, ...parts] = trimmed.split('=');
          const val = parts.join('=').trim().replace(/^['"]|['"]$/g, '');
          if (key.trim() === 'LAST30DAYS_MEMORY_DIR') {
            if (val.startsWith('~/')) {
              return path.join(home, val.substring(2));
            }
            return path.resolve(val);
          }
        }
      }
    } catch (e) {
      console.warn('Error reading config for memory dir:', e.message);
    }
  }

  return path.join(home, 'Documents/Last30Days');
}

const app = express();
const PORT = process.env.PORT || 3000;
const MEMORY_DIR = findMemoryDir();


app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Helper to parse a single last30days markdown file into structured JSON
function parseMarkdownReport(filePath, fileName) {
  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split('\n');

  let title = 'Unknown Report';
  let dateRange = '';
  let sourcesList = [];
  let resolvedEntities = [];
  let clusters = [];
  let stats = {};
  let sourceCoverage = {};
  let webResults = [];

  let currentSection = '';
  let currentCluster = null;
  let currentItem = null;

  // Extract Title from first line: "# last30days v3.3.2: Peter Steinberger"
  const titleLine = lines[0] || '';
  const titleMatch = titleLine.match(/# last30days v[0-9.]+:?\s*(.*)/);
  if (titleMatch) {
    title = titleMatch[1].trim();
  } else {
    // fallback to filename
    title = fileName.replace('-raw-v3.md', '').replace('-raw.md', '').replace(/-/g, ' ');
    title = title.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    if (!line) continue;

    // Detect major sections
    if (line.startsWith('## ')) {
      currentSection = line.substring(3).trim();
      currentCluster = null;
      currentItem = null;
      continue;
    }

    // Parse metadata from top
    if (currentSection === '') {
      if (line.startsWith('- Date range:')) {
        dateRange = line.replace('- Date range:', '').trim();
      } else if (line.startsWith('- Sources:')) {
        sourcesList = line.replace('- Sources:', '').trim().split(',').map(s => s.trim());
      }
    }

    // Parse Resolved Entities
    if (currentSection === 'Resolved Entities') {
      if (line.startsWith('- **')) {
        const entityMatch = line.match(/-\s*\*\*(.*?)\*\*:\s*(.*)/);
        if (entityMatch) {
          resolvedEntities.push({
            name: entityMatch[1].trim(),
            details: entityMatch[2].trim()
          });
        }
      }
    }

    // Parse Ranked Evidence Clusters
    if (currentSection === 'Ranked Evidence Clusters') {
      if (line.startsWith('### ')) {
        // New cluster, e.g. "### 1. Kimi Antonelli wins the 2026 Monaco Grand Prix (score 42, 1 item, sources: Reddit)"
        const clusterTitleText = line.substring(4).trim();
        let clusterMatch = clusterTitleText.match(/^(\d+)\.\s*(.*?)\s*\((score\s*\d+,\s*\d+\s*items?,\s*sources:\s*(.*?))\)$/i) || 
                           clusterTitleText.match(/^(\d+)\.\s*(.*?)\s*\((score\s*\d+,\s*\d+\s*items?)\)$/i);
        
        if (!clusterMatch) {
          const simpleMatch = clusterTitleText.match(/^(\d+)\.\s*(.*)/);
          if (simpleMatch) {
            clusterMatch = [
              clusterTitleText,
              simpleMatch[1],
              simpleMatch[2],
              "score 0, 0 items, sources: Unknown"
            ];
          }
        }
        
        if (clusterMatch) {
          currentCluster = {
            id: parseInt(clusterMatch[1]),
            title: clusterMatch[2].trim(),
            metadata: clusterMatch[3].trim(),
            items: []
          };
          clusters.push(currentCluster);
          currentItem = null;
        }
      } else if (currentCluster && line.match(/^\d+\.\s*\[(.*?)\]\s*(.*)/)) {
        // New item inside cluster, e.g. "1. [reddit] Kimi Antonelli wins the 2026 Monaco Grand Prix"
        const itemMatch = line.match(/^\d+\.\s*\[(.*?)\]\s*(.*)/);
        currentItem = {
          source: itemMatch[1].trim(),
          title: itemMatch[2].trim(),
          date: '',
          url: '',
          evidence: [],
          comments: [],
          insights: []
        };
        currentCluster.items.push(currentItem);
      } else if (currentItem) {
        // Parse details of current item
        if (line.startsWith('- ')) {
          if (line.startsWith('- URL:')) {
            currentItem.url = line.replace('- URL:', '').trim();
          } else if (line.startsWith('- Evidence:')) {
            currentItem.evidence.push(line.replace('- Evidence:', '').trim());
          } else if (line.startsWith('- Insight:')) {
            currentItem.insights.push(line.replace('- Insight:', '').trim());
          } else {
            // Check if it matches a comment pattern, e.g. "- u/user (12 upvotes): text" or "- pg (15 points): text"
            const commentMatch = line.match(/^-\s*([@a-zA-Z0-9_\-\/\[\]]+)\s*\(([-+\d,\.\s\w]+)\):\s*(.*)/);
            if (commentMatch) {
              currentItem.comments.push({
                user: commentMatch[1].trim(),
                votes: commentMatch[2].trim(),
                text: commentMatch[3].trim()
              });
            } else {
              // Check if it's date/score line, e.g. "- 2026-06-07 | r/formula1 | [21,292pts, 1,322cmt] | score:42"
              const metaLine = line.substring(2);
              if (metaLine.match(/^\d{4}-\d{2}-\d{2}/)) {
                currentItem.date = metaLine.split('|')[0].trim();
                currentItem.sourceDetail = metaLine.split('|').slice(1).map(s => s.trim()).join(' | ');
              } else {
                currentItem.evidence.push(metaLine);
              }
            }
          }
        } else {
          // Parse user comments without leading hyphen
          const commentMatch = line.match(/^([@a-zA-Z0-9_\-\/\[\]]+)\s*\(([-+\d,\.\s\w]+)\):\s*(.*)/);
          if (commentMatch) {
            currentItem.comments.push({
              user: commentMatch[1].trim(),
              votes: commentMatch[2].trim(),
              text: commentMatch[3].trim()
            });
          }
        }
      }
    }

    // Parse Stats & Source Coverage
    if (currentSection === 'Stats') {
      if (line.startsWith('- ')) {
        const statMatch = line.match(/-\s*(.*?):\s*(.*)/);
        if (statMatch) {
          stats[statMatch[1].trim()] = statMatch[2].trim();
        }
      }
    }

    if (currentSection === 'Source Coverage') {
      if (line.startsWith('- ')) {
        const covMatch = line.match(/-\s*(.*?):\s*(.*)/);
        if (covMatch) {
          sourceCoverage[covMatch[1].trim()] = covMatch[2].trim();
        }
      }
    }

    // Parse WebSearch Supplemental Results
    if (currentSection === 'WebSearch Supplemental Results') {
      if (line.startsWith('- **')) {
        const webMatch = line.match(/-\s*\*\*(.*?)\*\*\s*\((.*?)\)\s*—\s*(.*)/);
        if (webMatch) {
          webResults.push({
            publisher: webMatch[1].trim(),
            domain: webMatch[2].trim(),
            excerpt: webMatch[3].trim()
          });
        }
      }
    }
  }

  // Fallback stats logic if not parsed perfectly
  if (Object.keys(stats).length === 0) {
    stats = {
      "Total evidence": `${clusters.reduce((acc, c) => acc + c.items.length, 0)} items`,
      "Top sources": sourcesList.join(', ')
    };
  }

  return {
    id: fileName.replace('.md', ''),
    fileName,
    title,
    dateRange,
    sourcesList,
    resolvedEntities,
    clusters,
    stats,
    sourceCoverage,
    webResults
  };
}

// Endpoint to list all reports in Documents/Last30Days
app.get('/api/reports', (req, res) => {
  try {
    if (!fs.existsSync(MEMORY_DIR)) {
      return res.json([]);
    }

    const files = fs.readdirSync(MEMORY_DIR).filter(file => file.endsWith('.md'));
    const reportsList = files.map(file => {
      const filePath = path.join(MEMORY_DIR, file);
      const content = fs.readFileSync(filePath, 'utf-8');
      
      // Simple parse to get basic info
      let title = file.replace('-raw-v3.md', '').replace('-raw.md', '').replace(/-/g, ' ');
      title = title.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
      const titleMatch = content.match(/# last30days v[0-9.]+:?\s*(.*)/);
      if (titleMatch) {
        title = titleMatch[1].trim();
      }

      const statsMatch = content.match(/Total evidence:\s*(.*)/);
      const totalEvidence = statsMatch ? statsMatch[1].trim() : 'Unknown items';

      const mtime = fs.statSync(filePath).mtime;

      return {
        id: file.replace('.md', ''),
        fileName: file,
        title,
        totalEvidence,
        lastUpdated: mtime
      };
    }).sort((a, b) => b.lastUpdated - a.lastUpdated);

    res.json(reportsList);
  } catch (error) {
    console.error('Error fetching reports:', error);
    res.status(500).json({ error: 'Failed to read reports directory' });
  }
});

// Endpoint to get a specific report details
app.get('/api/reports/:id', (req, res) => {
  try {
    const reportId = req.params.id;
    const fileName = reportId.endsWith('.md') ? reportId : `${reportId}.md`;
    const filePath = path.join(MEMORY_DIR, fileName);

    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'Report not found' });
    }

    const parsedData = parseMarkdownReport(filePath, fileName);
    res.json(parsedData);
  } catch (error) {
    console.error('Error fetching report detail:', error);
    res.status(500).json({ error: 'Failed to parse report file' });
  }
});

// JSON database for ratings
const RATINGS_FILE = path.join(__dirname, 'ratings.json');

function loadRatings() {
  try {
    if (fs.existsSync(RATINGS_FILE)) {
      return JSON.parse(fs.readFileSync(RATINGS_FILE, 'utf-8'));
    }
  } catch (e) {
    console.error('Error loading ratings:', e);
  }
  return {};
}

function saveRatings(ratings) {
  try {
    fs.writeFileSync(RATINGS_FILE, JSON.stringify(ratings, null, 2), 'utf-8');
  } catch (e) {
    console.error('Error saving ratings:', e);
  }
}

// Endpoint to get all ratings for a report
app.get('/api/reports/:id/ratings', (req, res) => {
  const reportId = req.params.id;
  const allRatings = loadRatings();
  res.json(allRatings[reportId] || {});
});

// Endpoint to rate an item (e.g. cluster or specific url) in a report
app.post('/api/reports/:id/rate', (req, res) => {
  const reportId = req.params.id;
  const { targetId, rating } = req.body; // targetId can be a cluster title or item URL

  if (!targetId || rating === undefined) {
    return res.status(400).json({ error: 'targetId and rating are required' });
  }

  const allRatings = loadRatings();
  if (!allRatings[reportId]) {
    allRatings[reportId] = {};
  }

  allRatings[reportId][targetId] = Number(rating);
  saveRatings(allRatings);

  res.json({ success: true, ratings: allRatings[reportId] });
});

// Active background research jobs
// Helper to find the last30days.py script path dynamically across various setups
function findScriptPath() {
  if (process.env.LAST30DAYS_SKILL_DIR) {
    const candidate = path.join(process.env.LAST30DAYS_SKILL_DIR, 'scripts/last30days.py');
    if (fs.existsSync(candidate)) return candidate;
  }
  
  const home = process.env.HOME || '/home/lazorr';
  
  const commonPaths = [
    path.join(__dirname, 'last30days-skill/skills/last30days/scripts/last30days.py'),
    path.join(__dirname, '../last30days-skill/skills/last30days/scripts/last30days.py'),
    path.join(home, '.agents/skills/last30days/scripts/last30days.py'),
    path.join(home, '.config/last30days/scripts/last30days.py'),
  ];
  for (const p of commonPaths) {
    if (fs.existsSync(p)) return p;
  }

  const claudeCacheDir = path.join(home, '.claude/plugins/cache');
  if (fs.existsSync(claudeCacheDir)) {
    try {
      const searchDir = (dir, depth = 0) => {
        if (depth > 4) return null;
        const items = fs.readdirSync(dir);
        for (const item of items) {
          const fullPath = path.join(dir, item);
          const stat = fs.statSync(fullPath);
          if (stat.isDirectory()) {
            const found = searchDir(fullPath, depth + 1);
            if (found) return found;
          } else if (item === 'last30days.py') {
            return fullPath;
          }
        }
        return null;
      };
      const found = searchDir(claudeCacheDir);
      if (found) return found;
    } catch (e) {
      console.warn('Error searching Claude cache:', e.message);
    }
  }

  return path.join(home, '.agents/skills/last30days/scripts/last30days.py');
}

// Helper to find virtualenv python executable for the resolved script
function findPythonPath(scriptPath) {
  if (scriptPath) {
    let dir = path.dirname(scriptPath);
    for (let i = 0; i < 4; i++) {
      const venvPython = path.join(dir, '.venv/bin/python');
      if (fs.existsSync(venvPython)) {
        return venvPython;
      }
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  }
  return 'python3';
}

const activeJobs = {};
let jobCounter = 0;

// Endpoint to run a new research task
app.post('/api/run', (req, res) => {
  try {
    const { topic, quick, deep, mock, subreddits, xHandle, githubUser, githubRepo, search } = req.body;
    
    if (!topic || !topic.trim()) {
      return res.status(400).json({ error: 'Research topic is required' });
    }

    const jobId = ++jobCounter;
    const scriptPath = findScriptPath();

    if (!fs.existsSync(scriptPath)) {
      return res.status(500).json({ error: `last30days script not found at ${scriptPath}` });
    }


    // Build arguments
    const args = [topic.trim(), '--save-dir', MEMORY_DIR, '--emit', 'compact'];
    if (quick) args.push('--quick');
    if (deep) args.push('--deep');
    if (mock) args.push('--mock');
    if (subreddits && subreddits.trim()) args.push('--subreddits', subreddits.trim());
    if (xHandle && xHandle.trim()) args.push('--x-handle', xHandle.trim());
    if (githubUser && githubUser.trim()) args.push('--github-user', githubUser.trim());
    if (githubRepo && githubRepo.trim()) args.push('--github-repo', githubRepo.trim());
    if (search && search.trim()) args.push('--search', search.trim());

    const pythonExecutable = findPythonPath(scriptPath);
    console.log(`[Job ${jobId}] Spawning: ${pythonExecutable} ${scriptPath} ${args.map(a => `"${a}"`).join(' ')}`);

    const child = spawn(pythonExecutable, [scriptPath, ...args], {
      env: { ...process.env, PYTHONUNBUFFERED: '1' }
    });

    const job = {
      id: jobId,
      topic: topic.trim(),
      status: 'running',
      logs: '',
      exitCode: null,
      startedAt: new Date(),
      finishedAt: null
    };

    activeJobs[jobId] = job;

    child.stdout.on('data', (data) => {
      job.logs += data.toString();
    });

    child.stderr.on('data', (data) => {
      job.logs += data.toString();
    });

    child.on('error', (err) => {
      console.error(`[Job ${jobId}] Process error:`, err);
      job.status = 'failed';
      job.logs += `\n[Server Error] Failed to start process: ${err.message}\n`;
      job.finishedAt = new Date();
    });

    child.on('close', (code) => {
      job.status = code === 0 ? 'completed' : 'failed';
      job.exitCode = code;
      job.finishedAt = new Date();
      console.log(`[Job ${jobId}] Completed with exit code ${code}`);
    });

    res.json({ success: true, jobId, status: 'running' });
  } catch (error) {
    console.error('Error starting research job:', error);
    res.status(500).json({ error: 'Failed to initiate research job' });
  }
});

// Endpoint to check job status and retrieve logs
app.get('/api/jobs/:id', (req, res) => {
  const job = activeJobs[req.params.id];
  if (!job) {
    return res.status(404).json({ error: 'Job not found' });
  }
  res.json(job);
});

app.listen(PORT, () => {
  console.log(`Last30Days Web Dashboard running on http://localhost:${PORT}`);
});

