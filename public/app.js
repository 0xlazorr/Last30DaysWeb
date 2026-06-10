// State Management
let allReports = [];
let currentReportId = null;
let currentReportData = null;
let coverageChartInstance = null;
const apiBase = '/api';

// DOM Elements
const reportsList = document.getElementById('reportsList');
const reportTitle = document.getElementById('reportTitle');
const reportMeta = document.getElementById('reportMeta');
const welcomeScreen = document.getElementById('welcomeScreen');
const dashboardView = document.getElementById('dashboardView');
const refreshBtn = document.getElementById('refreshBtn');

// KPIs
const kpiTotal = document.getElementById('kpiTotal');
const kpiReddit = document.getElementById('kpiReddit');
const kpiHn = document.getElementById('kpiHn');
const kpiWeb = document.getElementById('kpiWeb');

// Tab contents & buttons
const tabBtns = document.querySelectorAll('.tab-btn');
const tabContents = document.querySelectorAll('.tab-content');

// Lists/grids
const clustersList = document.getElementById('clustersList');
const webList = document.getElementById('webList');
const entitiesGrid = document.getElementById('entitiesGrid');
const coverageList = document.getElementById('coverageList');
const metricsList = document.getElementById('metricsList');

// Filter & search
const clusterSearch = document.getElementById('clusterSearch');
const clusterSort = document.getElementById('clusterSort');

// Modal Elements
const detailModal = document.getElementById('detailModal');
const modalClose = document.getElementById('modalClose');
const modalTitle = document.getElementById('modalTitle');
const modalBadge = document.getElementById('modalBadge');
const modalDate = document.getElementById('modalDate');
const modalSourceDetail = document.getElementById('modalSourceDetail');
const modalSnippet = document.getElementById('modalSnippet');
const modalCommentsSection = document.getElementById('modalCommentsSection');
const modalComments = document.getElementById('modalComments');
const modalInsightsSection = document.getElementById('modalInsightsSection');
const modalInsights = document.getElementById('modalInsights');
const modalLink = document.getElementById('modalLink');

// --- Initialization ---
document.addEventListener('DOMContentLoaded', async () => {
  const urlParams = new URLSearchParams(window.location.search);
  const reportParam = urlParams.get('report');
  if (reportParam) {
    currentReportId = reportParam;
  }

  await fetchReports();
  setupEventListeners();
  setupResearchModal();

  if (reportParam) {
    loadReportDetails(reportParam);
  }
});


function setupEventListeners() {
  refreshBtn.addEventListener('click', () => {
    fetchReports();
    if (currentReportId) {
      loadReportDetails(currentReportId);
    }
  });

  // Tab switching
  tabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      tabBtns.forEach(b => b.classList.remove('active'));
      tabContents.forEach(c => c.classList.remove('active'));
      
      btn.classList.add('active');
      const tabId = btn.getAttribute('data-tab');
      document.getElementById(tabId).classList.add('active');
    });
  });

  // Search & Filter change events
  clusterSearch.addEventListener('input', renderClusters);
  clusterSort.addEventListener('change', renderClusters);

  // Briefing search
  const briefingSearch = document.getElementById('briefingSearch');
  briefingSearch.addEventListener('input', renderReportsList);

  // Modal actions
  modalClose.addEventListener('click', closeModal);
  detailModal.addEventListener('click', (e) => {
    if (e.target === detailModal) closeModal();
  });
}

// --- Fetch API: List Reports ---
async function fetchReports(retries = 5, delay = 500) {
  try {
    reportsList.innerHTML = '<div class="loading-state"><div class="spinner"></div><p>Loading briefings...</p></div>';
    
    const response = await fetch(`${apiBase}/reports`);
    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
    allReports = await response.json();
    renderReportsList();
  } catch (error) {
    console.error('Error listing reports:', error);
    if (retries > 0) {
      console.log(`Retrying fetchReports... (${retries} retries left)`);
      await new Promise(resolve => setTimeout(resolve, delay));
      return fetchReports(retries - 1, delay);
    }
    reportsList.innerHTML = '<div class="loading-state"><p>Failed to retrieve briefings. Is the backend server running?</p></div>';
  }
}

function renderReportsList() {
  const query = document.getElementById('briefingSearch').value.toLowerCase();
  
  if (allReports.length === 0) {
    reportsList.innerHTML = '<div class="loading-state"><p>No briefings found in Documents/Last30Days.</p></div>';
    return;
  }

  const filtered = allReports.filter(r => r.title.toLowerCase().includes(query));

  reportsList.innerHTML = '';
  if (filtered.length === 0) {
    reportsList.innerHTML = '<div class="loading-state"><p>No matching briefings.</p></div>';
    return;
  }

  filtered.forEach(report => {
    const activeClass = report.id === currentReportId ? 'active' : '';
    const dateText = new Date(report.lastUpdated).toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });

    const card = document.createElement('div');
    card.className = `report-item ${activeClass}`;
    card.setAttribute('data-id', report.id);
    card.innerHTML = `
      <div class="report-item-title">${report.title}</div>
      <div class="report-item-meta">
        <span><i class="fa-solid fa-file-invoice"></i> ${report.totalEvidence}</span>
        <span><i class="fa-regular fa-clock"></i> ${dateText}</span>
      </div>
    `;

    card.addEventListener('click', () => {
      document.querySelectorAll('.report-item').forEach(i => i.classList.remove('active'));
      card.classList.add('active');
      loadReportDetails(report.id);
    });

    reportsList.appendChild(card);
  });
}

// --- Fetch API: Get Report Detail ---
async function loadReportDetails(reportId) {
  try {
    currentReportId = reportId;
    welcomeScreen.style.display = 'none';
    dashboardView.style.display = 'block';

    const response = await fetch(`${apiBase}/reports/${reportId}`);
    const report = await response.json();
    
    let ratings = {};
    try {
      const ratingsResponse = await fetch(`${apiBase}/reports/${reportId}/ratings`);
      if (ratingsResponse.ok) {
        ratings = await ratingsResponse.json();
      }
    } catch (e) {
      console.error('Error fetching ratings:', e);
    }
    
    report.ratings = ratings;
    currentReportData = report;

    // Render header details
    reportTitle.textContent = report.title;
    reportMeta.innerHTML = `<i class="fa-solid fa-calendar-days"></i> ${report.dateRange || 'Last 30 Days'} &nbsp;&nbsp; <i class="fa-solid fa-layer-group"></i> Sources: ${report.sourcesList.join(', ')}`;

    // Populate KPIs
    kpiTotal.textContent = report.clusters.reduce((acc, c) => acc + c.items.length, 0) + (report.webResults?.length || 0);
    
    // Count sources for KPIs
    let redditCount = 0;
    let hnCount = 0;
    
    report.clusters.forEach(c => {
      c.items.forEach(item => {
        if (item.source.toLowerCase() === 'reddit') redditCount++;
        else if (item.source.toLowerCase() === 'hackernews') hnCount++;
      });
    });

    kpiReddit.textContent = redditCount;
    kpiHn.textContent = hnCount;
    kpiWeb.textContent = report.webResults?.length || 0;

    // Render tabs contents
    renderClusters();
    renderWebSupplements();
    renderEntities();
    renderCoverageAndStats();
  } catch (error) {
    console.error('Error loading report details:', error);
  }
}

// --- Render tab: Clusters ---
function renderClusters() {
  if (!currentReportData) return;

  const searchQuery = clusterSearch.value.toLowerCase();
  const sortBy = clusterSort.value;

  // Filter
  let filtered = currentReportData.clusters.filter(c => {
    const titleMatch = c.title.toLowerCase().includes(searchQuery);
    const itemMatch = c.items.some(item => 
      item.title.toLowerCase().includes(searchQuery) || 
      item.evidence.some(e => e.toLowerCase().includes(searchQuery))
    );
    return titleMatch || itemMatch;
  });

  // Sort
  if (sortBy === 'score-desc') {
    filtered.sort((a, b) => {
      const aScore = parseInt(a.metadata.match(/score\s*(\d+)/)?.[1] || 0);
      const bScore = parseInt(b.metadata.match(/score\s*(\d+)/)?.[1] || 0);
      return bScore - aScore;
    });
  } else if (sortBy === 'rating-desc') {
    filtered.sort((a, b) => {
      const aRating = currentReportData.ratings?.[a.title] || 0;
      const bRating = currentReportData.ratings?.[b.title] || 0;
      if (bRating === aRating) {
        const aScore = parseInt(a.metadata.match(/score\s*(\d+)/)?.[1] || 0);
        const bScore = parseInt(b.metadata.match(/score\s*(\d+)/)?.[1] || 0);
        return bScore - aScore;
      }
      return bRating - aRating;
    });
  } else if (sortBy === 'id-asc') {
    filtered.sort((a, b) => a.id - b.id);
  } else if (sortBy === 'items-desc') {
    filtered.sort((a, b) => b.items.length - a.items.length);
  }

  clustersList.innerHTML = '';
  if (filtered.length === 0) {
    clustersList.innerHTML = '<div class="loading-state"><p>No clusters match your search query.</p></div>';
    return;
  }

  filtered.forEach(c => {
    const scoreVal = c.metadata.match(/score\s*(\d+)/)?.[1] || '0';
    const sourceTypes = c.metadata.match(/sources:\s*(.*)/)?.[1] || 'Reddit, HN';

    const card = document.createElement('div');
    card.className = 'cluster-card';
    card.innerHTML = `
      <div class="cluster-header">
        <div class="cluster-title-area">
          <h3>${c.title}</h3>
          <div class="cluster-meta-row">
            <span class="cluster-meta-tag"><i class="fa-solid fa-list-check"></i> ${c.items.length} items</span>
            <span class="cluster-meta-tag"><i class="fa-solid fa-network-wired"></i> ${sourceTypes}</span>
            <span class="cluster-meta-tag rating-meta-tag"></span>
          </div>
        </div>
        <div class="cluster-score">Score ${scoreVal}</div>
      </div>
      <div class="cluster-items-list">
        <!-- populated below -->
      </div>
    `;

    // Append stars to rating-meta-tag
    const ratingTag = card.querySelector('.rating-meta-tag');
    const currentRating = currentReportData.ratings?.[c.title] || 0;
    
    const label = document.createElement('span');
    label.textContent = 'Relevance: ';
    label.style.marginRight = '4px';
    label.style.color = 'var(--text-muted)';
    ratingTag.appendChild(label);

    const stars = renderStars(currentRating, (newRating) => {
      submitRating(c.title, newRating);
    });
    ratingTag.appendChild(stars);

    const itemsList = card.querySelector('.cluster-items-list');
    c.items.forEach(item => {
      const sourceClass = `source-${item.source.toLowerCase()}`;
      
      // Look up if this individual item is rated
      const itemRating = currentReportData.ratings?.[item.url] || 0;
      let ratingIndicator = '';
      if (itemRating > 0) {
        ratingIndicator = `<span class="item-rating-indicator"><i class="fa-solid fa-star"></i> ${itemRating}</span>`;
      }

      const row = document.createElement('div');
      row.className = 'cluster-item-row';
      row.innerHTML = `
        <div class="item-header">
          <div class="item-source">
            <span class="source-badge ${sourceClass}">${item.source}</span>
            <span class="item-title">${item.title}</span>
          </div>
          <div style="display: flex; align-items: center; gap: 8px;">
            ${ratingIndicator}
            <span class="item-date">${item.date || ''}</span>
          </div>
        </div>
        ${item.evidence[0] ? `<p class="item-snippet">${item.evidence[0]}</p>` : ''}
      `;

      row.addEventListener('click', (e) => {
        e.stopPropagation();
        openDetailModal(item);
      });

      itemsList.appendChild(row);
    });

    clustersList.appendChild(card);
  });
}

// --- Render tab: Web Supplements ---
function renderWebSupplements() {
  if (!currentReportData) return;

  webList.innerHTML = '';
  const webResults = currentReportData.webResults || [];

  if (webResults.length === 0) {
    webList.innerHTML = '<div class="loading-state"><p>No supplemental web search results appended to this report.</p></div>';
    return;
  }

  webResults.forEach(res => {
    const item = document.createElement('div');
    item.className = 'web-item';
    item.innerHTML = `
      <div class="web-header">
        <div class="web-publisher"><i class="fa-solid fa-globe"></i> ${res.publisher}</div>
        <div class="web-domain">${res.domain}</div>
      </div>
      <p class="web-excerpt">${res.excerpt}</p>
    `;
    webList.appendChild(item);
  });
}

// --- Render tab: Resolved Entities ---
function renderEntities() {
  if (!currentReportData) return;

  entitiesGrid.innerHTML = '';
  const entities = currentReportData.resolvedEntities || [];

  if (entities.length === 0) {
    entitiesGrid.innerHTML = '<div class="loading-state"><p>No pre-flight coordinates/entities resolved for this briefing.</p></div>';
    return;
  }

  entities.forEach(entity => {
    const card = document.createElement('div');
    card.className = 'entity-card';
    card.innerHTML = `
      <h3>${entity.name}</h3>
      <p>${entity.details}</p>
    `;
    entitiesGrid.appendChild(card);
  });
}

// --- Render right column stats & coverage ---
function renderCoverageAndStats() {
  if (!currentReportData) return;

  // 1. Populate stats/topic metrics list
  metricsList.innerHTML = '';
  const statsKeys = Object.keys(currentReportData.stats);
  statsKeys.forEach(k => {
    const row = document.createElement('div');
    row.className = 'metric-row';
    row.innerHTML = `
      <span class="metric-name">${k}</span>
      <span class="metric-value">${currentReportData.stats[k]}</span>
    `;
    metricsList.appendChild(row);
  });

  // 2. Populate coverage lists & render chart
  coverageList.innerHTML = '';
  const coverageData = [];
  const coverageLabels = [];
  const coverageColors = [];

  const sourceMap = {
    'reddit': { color: '#f97316', label: 'Reddit', icon: 'fa-brands fa-reddit-alien' },
    'hackernews': { color: '#f59e0b', label: 'Hacker News', icon: 'fa-brands fa-y-combinator' },
    'hacker news': { color: '#f59e0b', label: 'Hacker News', icon: 'fa-brands fa-y-combinator' },
    'web': { color: '#3b82f6', label: 'WebSearch', icon: 'fa-solid fa-globe' }
  };

  const covKeys = Object.keys(currentReportData.sourceCoverage);
  covKeys.forEach(k => {
    const count = parseInt(currentReportData.sourceCoverage[k].match(/(\d+)/)?.[1] || 0);
    const keyLower = k.toLowerCase();
    const mapping = sourceMap[keyLower] || { color: '#6366f1', label: k, icon: 'fa-solid fa-database' };

    coverageLabels.push(mapping.label);
    coverageData.push(count);
    coverageColors.push(mapping.color);

    // List item
    const row = document.createElement('div');
    row.className = 'coverage-item';
    row.innerHTML = `
      <span class="coverage-name">
        <span style="color: ${mapping.color};"><i class="${mapping.icon}"></i></span> ${mapping.label}
      </span>
      <span class="coverage-value">${currentReportData.sourceCoverage[k]}</span>
    `;
    coverageList.appendChild(row);
  });

  // 3. Render Chart.js
  const ctx = document.getElementById('coverageChart').getContext('2d');
  
  if (coverageChartInstance) {
    coverageChartInstance.destroy();
  }

  if (coverageData.length > 0) {
    coverageChartInstance = new Chart(ctx, {
      type: 'doughnut',
      data: {
        labels: coverageLabels,
        datasets: [{
          data: coverageData,
          backgroundColor: coverageColors,
          borderWidth: 2,
          borderColor: '#131427'
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            display: false
          }
        },
        cutout: '75%'
      }
    });
  } else {
    // Draw empty state
    ctx.clearRect(0, 0, 200, 200);
  }
}

// --- Modal Handling ---
function openDetailModal(item) {
  modalTitle.textContent = item.title;
  modalBadge.textContent = item.source;
  modalBadge.className = `modal-source-badge source-${item.source.toLowerCase()}`;
  modalDate.textContent = item.date || 'No Date';
  modalSourceDetail.textContent = item.sourceDetail || '';
  
  // Rating inside modal
  const modalRatingContainer = document.getElementById('modalRatingContainer');
  const ratingMeta = document.querySelector('.rating-meta');
  modalRatingContainer.innerHTML = '';
  
  if (item.url) {
    ratingMeta.style.display = 'inline-flex';
    const currentRating = currentReportData.ratings?.[item.url] || 0;
    const stars = renderStars(currentRating, async (newRating) => {
      await submitRating(item.url, newRating);
      openDetailModal(item);
    });
    modalRatingContainer.appendChild(stars);
  } else {
    ratingMeta.style.display = 'none';
  }
  
  // Snippet
  modalSnippet.textContent = item.evidence.join('\n\n');

  // Comments
  if (item.comments && item.comments.length > 0) {
    modalCommentsSection.style.display = 'block';
    modalComments.innerHTML = '';
    item.comments.forEach(c => {
      const commentItem = document.createElement('div');
      commentItem.className = 'comment-item';
      commentItem.innerHTML = `
        <div class="comment-user-row">
          <span class="comment-user">${c.user}</span>
          <span class="comment-votes">${c.votes}</span>
        </div>
        <p class="comment-text">${c.text}</p>
      `;
      modalComments.appendChild(commentItem);
    });
  } else {
    modalCommentsSection.style.display = 'none';
  }

  // Insights
  if (item.insights && item.insights.length > 0) {
    modalInsightsSection.style.display = 'block';
    modalInsights.innerHTML = '';
    item.insights.forEach(ins => {
      const insightItem = document.createElement('div');
      insightItem.className = 'insight-item';
      insightItem.textContent = ins;
      modalInsights.appendChild(insightItem);
    });
  } else {
    modalInsightsSection.style.display = 'none';
  }

  // Link
  if (item.url) {
    modalLink.style.display = 'inline-flex';
    modalLink.href = item.url;
  } else {
    modalLink.style.display = 'none';
  }

  detailModal.style.display = 'flex';
}

function closeModal() {
  detailModal.style.display = 'none';
}

// --- Star Ratings helper ---
function renderStars(currentRating, onRateCallback) {
  const container = document.createElement('div');
  container.className = 'rating-stars';
  for (let i = 1; i <= 5; i++) {
    const star = document.createElement('i');
    star.className = i <= currentRating ? 'fa-solid fa-star' : 'fa-regular fa-star';
    star.dataset.value = i;
    star.style.cursor = 'pointer';
    star.style.transition = 'color var(--transition-fast), transform var(--transition-fast)';
    
    // Hover effects
    star.addEventListener('mouseenter', () => {
      const siblings = container.querySelectorAll('i');
      siblings.forEach(s => {
        const val = parseInt(s.dataset.value);
        if (val <= i) {
          s.className = 'fa-solid fa-star';
          s.style.color = 'var(--accent-yellow)';
        } else {
          s.className = 'fa-regular fa-star';
          s.style.color = '';
        }
      });
    });
    
    star.addEventListener('mouseleave', () => {
      const siblings = container.querySelectorAll('i');
      siblings.forEach(s => {
        const val = parseInt(s.dataset.value);
        if (val <= currentRating) {
          s.className = 'fa-solid fa-star';
          s.style.color = 'var(--accent-yellow)';
        } else {
          s.className = 'fa-regular fa-star';
          s.style.color = '';
        }
      });
    });
    
    star.addEventListener('click', (e) => {
      e.stopPropagation();
      const clickVal = i;
      const targetRating = clickVal === currentRating ? 0 : clickVal;
      onRateCallback(targetRating);
    });
    
    container.appendChild(star);
  }
  return container;
}

// --- Submit rating ---
async function submitRating(targetId, rating) {
  try {
    const response = await fetch(`${apiBase}/reports/${currentReportId}/rate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ targetId, rating })
    });
    
    const result = await response.json();
    if (result.success) {
      if (!currentReportData.ratings) {
        currentReportData.ratings = {};
      }
      currentReportData.ratings[targetId] = rating;
      renderClusters();
    }
  } catch (error) {
    console.error('Error submitting rating:', error);
  }
}

// --- Setup Research Modal & Trigger Research ---
function setupResearchModal() {
  const newResearchBtn = document.getElementById('newResearchBtn');
  const welcomeNewResearchBtn = document.getElementById('welcomeNewResearchBtn');
  const researchModal = document.getElementById('researchModal');
  const researchModalClose = document.getElementById('researchModalClose');
  const researchForm = document.getElementById('researchForm');
  const researchCancelBtn = document.getElementById('researchCancelBtn');
  
  const researchTopic = document.getElementById('researchTopic');
  const researchSources = document.getElementById('researchSources');
  const researchSubreddits = document.getElementById('researchSubreddits');
  const researchXHandle = document.getElementById('researchXHandle');
  const researchGithubUser = document.getElementById('researchGithubUser');
  const researchGithubRepo = document.getElementById('researchGithubRepo');
  const researchQuick = document.getElementById('researchQuick');
  const researchDeep = document.getElementById('researchDeep');
  const researchMock = document.getElementById('researchMock');
  
  const researchConsoleSection = document.getElementById('researchConsoleSection');
  const researchConsole = document.getElementById('researchConsole');
  const researchStatusBadge = document.getElementById('researchStatusBadge');
  const researchSubmitBtn = document.getElementById('researchSubmitBtn');
  
  let pollingInterval = null;

  const openResearchModal = () => {
    researchModal.style.display = 'flex';
    researchForm.reset();
    researchConsoleSection.style.display = 'none';
    researchConsole.textContent = '';
    researchSubmitBtn.disabled = false;
    researchSubmitBtn.innerHTML = '<i class="fa-solid fa-play"></i> Start Research';
  };

  // Open modal
  newResearchBtn.addEventListener('click', openResearchModal);
  if (welcomeNewResearchBtn) {
    welcomeNewResearchBtn.addEventListener('click', openResearchModal);
  }


  // Close modal helper
  const closeResearchModal = () => {
    if (pollingInterval) {
      clearInterval(pollingInterval);
      pollingInterval = null;
    }
    researchModal.style.display = 'none';
  };

  researchModalClose.addEventListener('click', closeResearchModal);
  researchCancelBtn.addEventListener('click', closeResearchModal);
  researchModal.addEventListener('click', (e) => {
    if (e.target === researchModal) closeResearchModal();
  });

  // Form submit
  researchForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const topic = researchTopic.value;
    if (!topic.trim()) return;

    researchSubmitBtn.disabled = true;
    researchSubmitBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Researching...';
    researchConsoleSection.style.display = 'block';
    researchConsole.textContent = 'Initializing background job...\n';
    researchStatusBadge.textContent = 'RUNNING';
    researchStatusBadge.style.backgroundColor = 'var(--accent-orange)';

    try {
      const response = await fetch(`${apiBase}/run`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          topic: topic.trim(),
          quick: researchQuick.checked,
          deep: researchDeep.checked,
          mock: researchMock.checked,
          search: researchSources.value,
          subreddits: researchSubreddits.value,
          xHandle: researchXHandle.value,
          githubUser: researchGithubUser.value,
          githubRepo: researchGithubRepo.value
        })
      });

      const data = await response.json();
      if (!response.ok || !data.success) {
        throw new Error(data.error || 'Failed to start research');
      }

      researchConsole.textContent += `[Server] Research job #${data.jobId} started successfully.\n\n`;
      
      // Start polling
      pollingInterval = setInterval(async () => {
        try {
          const jobResponse = await fetch(`${apiBase}/jobs/${data.jobId}`);
          if (!jobResponse.ok) {
            throw new Error('Failed to fetch job details');
          }
          
          const job = await jobResponse.json();
          researchConsole.textContent = job.logs || 'No log output yet...';
          researchConsole.scrollTop = researchConsole.scrollHeight;

          if (job.status === 'completed') {
            clearInterval(pollingInterval);
            pollingInterval = null;
            
            researchStatusBadge.textContent = 'COMPLETED';
            researchStatusBadge.style.backgroundColor = 'var(--accent-green)';
            researchSubmitBtn.innerHTML = '<i class="fa-solid fa-check"></i> Success!';
            
            researchConsole.textContent += '\n\n[Success] Research complete! Refreshing briefings list...';
            researchConsole.scrollTop = researchConsole.scrollHeight;

            // Reload reports list and select the newest one
            await fetchReports();
            if (allReports.length > 0) {
              loadReportDetails(allReports[0].id);
            }
            
            // Close modal after a short delay
            setTimeout(() => {
              closeResearchModal();
            }, 2000);
            
          } else if (job.status === 'failed') {
            clearInterval(pollingInterval);
            pollingInterval = null;
            
            researchStatusBadge.textContent = 'FAILED';
            researchStatusBadge.style.backgroundColor = '#ef4444';
            researchSubmitBtn.disabled = false;
            researchSubmitBtn.innerHTML = '<i class="fa-solid fa-play"></i> Start Research';
            
            researchConsole.textContent += `\n\n[Error] Job failed with exit code ${job.exitCode}.`;
            researchConsole.scrollTop = researchConsole.scrollHeight;
          }
        } catch (pollError) {
          console.error('Error polling job:', pollError);
        }
      }, 1000);

    } catch (err) {
      console.error('Error starting research:', err);
      researchConsole.textContent += `\n[Error] Could not start research: ${err.message}\n`;
      researchStatusBadge.textContent = 'FAILED';
      researchStatusBadge.style.backgroundColor = '#ef4444';
      researchSubmitBtn.disabled = false;
      researchSubmitBtn.innerHTML = '<i class="fa-solid fa-play"></i> Start Research';
    }
  });
}

