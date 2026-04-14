(function () {
  const panelMeta = document.getElementById("rainfallPanelMeta");
  const districtSummary = document.getElementById("districtRainfallSummary");
  const rankingList = document.getElementById("rainfallRanking");
  const rankingCaption = document.getElementById("rankingCaption");
  const districtFilter = document.getElementById("districtFilter");
  const rainfallTimeInput = document.getElementById("rainfallTimeInput");
  const rainfallTimeApply = document.getElementById("rainfallTimeApply");

  if (!panelMeta || !districtSummary || !rankingList || !rankingCaption) {
    return;
  }

  const rainfallDataUrls = ["./data/taoyuan_rainfall_24h_merged.json"];

  let rainfallPayload = null;
  let rainfallStations = [];

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function formatRainfall(value) {
    const amount = Number(value);
    if (!Number.isFinite(amount)) {
      return "無資料";
    }
    return `${Number.isInteger(amount) ? amount.toFixed(0) : amount.toFixed(1)} mm`;
  }

  function formatDisplayTime(value) {
    if (!value) {
      return "無資料";
    }

    const text = String(value).trim().replace("T", " ");
    const matched = text.match(/^(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2})/);
    if (matched) {
      return `${matched[1]} ${matched[2]}`;
    }
    return text;
  }

  function toDateTimeLocalValue(value) {
    if (!value) {
      return "";
    }
    const text = String(value).trim().replace(" ", "T");
    const matched = text.match(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2})/);
    if (matched) {
      return matched[1];
    }
    return "";
  }

  function toFileStamp(dateTimeLocal) {
    const matched = String(dateTimeLocal || "").match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/);
    if (!matched) {
      return "";
    }
    return `${matched[1]}${matched[2]}${matched[3]}_${matched[4]}${matched[5]}`;
  }

  function floorToTenMinutes(date) {
    const floored = new Date(date.getTime());
    const minute = floored.getMinutes();
    floored.setMinutes(Math.floor(minute / 10) * 10, 0, 0);
    return floored;
  }

  function pad2(value) {
    return String(value).padStart(2, "0");
  }

  function dateToFileStamp(date) {
    return `${date.getFullYear()}${pad2(date.getMonth() + 1)}${pad2(date.getDate())}_${pad2(date.getHours())}${pad2(date.getMinutes())}`;
  }

  function dateToDateTimeLocal(date) {
    return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}T${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
  }

  function buildDataUrlByStamp(stamp) {
    return `./data/taoyuan_rainfall_24h_${stamp}.json`;
  }

  function renderPanelMeta(payload, records, options = {}) {
    const requestedTime = escapeHtml(formatDisplayTime(payload?.requested_time));
    const windowStart = escapeHtml(formatDisplayTime(payload?.window_start));
    const windowEnd = escapeHtml(formatDisplayTime(payload?.window_end));
    const topStation = [...records].sort((a, b) => b.rainfall_24h_mm - a.rainfall_24h_mm)[0];

    const topSummary = topStation
      ? `全市最高為 ${escapeHtml(topStation.station_name)}（${escapeHtml(topStation.district)}），${formatRainfall(topStation.rainfall_24h_mm)}。`
      : "目前沒有可顯示的雨量資料。";

    const loadHint = options.queryTime
      ? `查詢時間：${escapeHtml(formatDisplayTime(options.queryTime))}<br>`
      : "";

    panelMeta.innerHTML = `${loadHint}資料時間：${requestedTime}<br>統計區間：${windowStart} 至 ${windowEnd}<br>${topSummary}`;
  }

  function getDistrictLeaders(records) {
    const leaders = new Map();

    records.forEach((record) => {
      const district = record.district;
      if (!district) {
        return;
      }

      const current = leaders.get(district);
      if (!current || record.rainfall_24h_mm > current.rainfall_24h_mm) {
        leaders.set(district, record);
      }
    });

    return [...leaders.values()].sort((a, b) => {
      if (b.rainfall_24h_mm !== a.rainfall_24h_mm) {
        return b.rainfall_24h_mm - a.rainfall_24h_mm;
      }
      return a.district.localeCompare(b.district, "zh-Hant");
    });
  }

  function renderDistrictLeaders(records) {
    const leaders = getDistrictLeaders(records);

    if (leaders.length === 0) {
      districtSummary.innerHTML = '<p class="empty-text">查無各區代表測站資料。</p>';
      return;
    }

    districtSummary.innerHTML = leaders
      .map((record) => `
        <article class="district-summary-card">
          <div class="district-summary-top">
            <div>
              <div class="district-name">${escapeHtml(record.district)}</div>
              <div class="district-summary-meta">代表站：${escapeHtml(record.station_name)}（${escapeHtml(record.station_id)}）</div>
            </div>
            <div class="rainfall-value">${formatRainfall(record.rainfall_24h_mm)}</div>
          </div>
        </article>
      `)
      .join("");
  }

  function getSelectedDistrict() {
    return districtFilter?.value || "ALL";
  }

  function getRankedStations(records, selectedDistrict) {
    return records
      .filter((record) => selectedDistrict === "ALL" || record.district === selectedDistrict)
      .sort((a, b) => {
        if (b.rainfall_24h_mm !== a.rainfall_24h_mm) {
          return b.rainfall_24h_mm - a.rainfall_24h_mm;
        }
        return a.station_name.localeCompare(b.station_name, "zh-Hant");
      });
  }

  function renderRanking(records) {
    const selectedDistrict = getSelectedDistrict();
    const rankedStations = getRankedStations(records, selectedDistrict);

    rankingCaption.textContent = selectedDistrict === "ALL"
      ? `顯示全部行政區，共 ${rankedStations.length} 站`
      : `目前篩選：${selectedDistrict}，共 ${rankedStations.length} 站`;

    if (rankedStations.length === 0) {
      rankingList.innerHTML = '<p class="empty-text">此行政區目前沒有雨量排行資料。</p>';
      return;
    }

    rankingList.innerHTML = rankedStations
      .map((record, index) => `
        <article class="ranking-row">
          <div class="ranking-main">
            <div class="ranking-station">
              <span class="rank-badge">${index + 1}</span>
              <div>
                <div class="station-name">${escapeHtml(record.station_name)}</div>
                <div class="station-meta">站號 ${escapeHtml(record.station_id)}</div>
                <div class="station-meta-row">
                  <span class="meta-pill">${escapeHtml(record.district)}</span>
                </div>
              </div>
            </div>
            <div class="rainfall-value">${formatRainfall(record.rainfall_24h_mm)}</div>
          </div>
        </article>
      `)
      .join("");
  }

  async function fetchRainfallPayload(customUrl) {
    if (customUrl) {
      const response = await fetch(customUrl);
      if (!response.ok) {
        throw new Error(`找不到指定時間資料檔 (${response.status})`);
      }
      return await response.json();
    }

    const errors = [];

    for (const url of rainfallDataUrls) {
      try {
        const response = await fetch(url);
        if (!response.ok) {
          throw new Error(`${response.status}`);
        }
        return await response.json();
      } catch (error) {
        errors.push(`${url}: ${error.message}`);
      }
    }

    throw new Error(errors.join("；"));
  }

  function normalizePayload(payload) {
    const records = Array.isArray(payload?.data) ? payload.data : [];

    return records
      .map((record) => ({
        station_id: String(record.station_id || "").trim(),
        station_name: String(record.station_name || "").trim(),
        county: String(record.county || "").trim(),
        district: String(record.district || "").trim(),
        rainfall_24h_mm: Number(record.rainfall_24h_mm),
        source: String(record.source || "").trim().toLowerCase()
      }))
      .filter((record) => record.station_id && record.station_name && Number.isFinite(record.rainfall_24h_mm));
  }

  function render(options = {}) {
    renderPanelMeta(rainfallPayload, rainfallStations, options);
    renderDistrictLeaders(rainfallStations);
    renderRanking(rainfallStations);
  }

  async function loadAndRender(customUrl, options = {}) {
    rainfallPayload = await fetchRainfallPayload(customUrl);
    rainfallStations = normalizePayload(rainfallPayload);

    if (rainfallStations.length === 0) {
      throw new Error("雨量 JSON 內沒有有效的 data 資料");
    }

    if (rainfallTimeInput) {
      const value = toDateTimeLocalValue(rainfallPayload?.requested_time);
      if (value) {
        rainfallTimeInput.value = value;
      }
    }

    render(options);
  }

  async function initRainfallPanel() {
    const defaultQueryDate = floorToTenMinutes(new Date());
    const defaultQueryLocal = dateToDateTimeLocal(defaultQueryDate);
    const defaultDataUrl = buildDataUrlByStamp(dateToFileStamp(defaultQueryDate));

    if (rainfallTimeInput) {
      rainfallTimeInput.value = defaultQueryLocal;
    }

    try {
      await loadAndRender(defaultDataUrl, { queryTime: defaultQueryLocal });
    } catch (error) {
      try {
        await loadAndRender();
      } catch (fallbackError) {
        panelMeta.textContent = `載入雨量統計失敗：${fallbackError.message}`;
        districtSummary.innerHTML = '<p class="empty-text">無法建立各區代表測站統計。</p>';
        rankingCaption.textContent = "排行榜載入失敗";
        rankingList.innerHTML = '<p class="empty-text">無法建立測站排行榜。</p>';
      }
    }
  }

  districtFilter?.addEventListener("change", () => {
    if (rainfallStations.length > 0) {
      renderRanking(rainfallStations);
    }
  });

  rainfallTimeApply?.addEventListener("click", async () => {
    const selectedTime = rainfallTimeInput?.value || "";
    const stamp = toFileStamp(selectedTime);

    if (!stamp) {
      panelMeta.textContent = "請先選擇有效的查詢時間（精確到分鐘）。";
      return;
    }

    const targetUrl = buildDataUrlByStamp(stamp);

    try {
      panelMeta.textContent = "指定時間資料載入中...";
      await loadAndRender(targetUrl, { queryTime: selectedTime });
    } catch (error) {
      panelMeta.textContent = `載入失敗：${error.message}`;
    }
  });

  initRainfallPanel();
})();