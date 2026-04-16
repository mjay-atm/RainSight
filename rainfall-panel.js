(function () {
  const panelMeta = document.getElementById("rainfallPanelMeta");
  const districtSummary = document.getElementById("districtRainfallSummary");
  const rankingList = document.getElementById("rainfallRanking");
  const rankingCaption = document.getElementById("rankingCaption");
  const districtFilter = document.getElementById("districtFilter");
  const rainfallDateInput = document.getElementById("rainfallDateInput");
  const rainfallHourSelect = document.getElementById("rainfallHourSelect");
  const rainfallMinuteSelect = document.getElementById("rainfallMinuteSelect");
  const rainfallTimeApply = document.getElementById("rainfallTimeApply");

  const TEN_MINUTE_OPTIONS = ["00", "10", "20", "30", "40", "50"];

  if (!panelMeta || !districtSummary || !rankingList || !rankingCaption) {
    return;
  }

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

  function normalizeDateTimeLocalToTenMinutes(value) {
    if (!value) {
      return "";
    }
    const matched = String(value).match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
    if (!matched) {
      return "";
    }

    const date = new Date(
      Number(matched[1]),
      Number(matched[2]) - 1,
      Number(matched[3]),
      Number(matched[4]),
      Number(matched[5]),
      0,
      0
    );

    if (Number.isNaN(date.getTime())) {
      return "";
    }

    return dateToDateTimeLocal(floorToTenMinutes(date));
  }

  function fillTimeSelectors() {
    if (rainfallHourSelect) {
      rainfallHourSelect.innerHTML = Array.from({ length: 24 }, (_, hour) => {
        const value = pad2(hour);
        return `<option value="${value}">${value} 時</option>`;
      }).join("");
    }

    if (rainfallMinuteSelect) {
      rainfallMinuteSelect.innerHTML = TEN_MINUTE_OPTIONS
        .map((minute) => `<option value="${minute}">${minute} 分</option>`)
        .join("");
    }
  }

  function setPickerFromDate(date) {
    if (!date || Number.isNaN(date.getTime())) {
      return;
    }

    if (rainfallDateInput) {
      rainfallDateInput.value = `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
    }

    if (rainfallHourSelect) {
      rainfallHourSelect.value = pad2(date.getHours());
    }

    if (rainfallMinuteSelect) {
      rainfallMinuteSelect.value = pad2(date.getMinutes());
    }
  }

  function setPickerFromDateTimeLocal(value) {
    const normalized = normalizeDateTimeLocalToTenMinutes(value);
    const matched = normalized.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})$/);
    if (!matched) {
      return;
    }

    if (rainfallDateInput) {
      rainfallDateInput.value = matched[1];
    }

    if (rainfallHourSelect) {
      rainfallHourSelect.value = matched[2];
    }

    if (rainfallMinuteSelect) {
      rainfallMinuteSelect.value = matched[3];
    }
  }

  function getSelectedDateTimeLocal() {
    const dateValue = rainfallDateInput?.value || "";
    const hourValue = rainfallHourSelect?.value || "";
    const minuteValue = rainfallMinuteSelect?.value || "";

    if (!dateValue || !hourValue || !minuteValue) {
      return "";
    }

    return `${dateValue}T${hourValue}:${minuteValue}`;
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

  function parseStampToDate(stamp) {
    const matched = String(stamp || "").match(/^(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})$/);
    if (!matched) {
      return null;
    }

    const date = new Date(
      Number(matched[1]),
      Number(matched[2]) - 1,
      Number(matched[3]),
      Number(matched[4]),
      Number(matched[5]),
      0,
      0
    );

    if (Number.isNaN(date.getTime())) {
      return null;
    }

    return date;
  }

  async function findNearestAvailableDataUrl(referenceDate) {
    const response = await fetch("./data/manifest.json");
    if (!response.ok) {
      throw new Error(`無法讀取 manifest.json (${response.status})`);
    }

    const manifest = await response.json();
    const stamp = manifest?.latest_stamp;
    const date = parseStampToDate(stamp);

    if (!stamp || !date) {
      throw new Error("manifest.json 中找不到可用雨量檔案");
    }

    const candidates = [{ stamp, date, url: buildDataUrlByStamp(stamp) }];

    candidates.sort((left, right) => {
      const leftDiff = Math.abs(left.date.getTime() - referenceDate.getTime());
      const rightDiff = Math.abs(right.date.getTime() - referenceDate.getTime());
      return leftDiff - rightDiff;
    });

    return candidates[0];
  }

  function renderPanelMeta(records) {
    const topStation = [...records].sort((a, b) => b.rainfall_24h_mm - a.rainfall_24h_mm)[0];

    const topSummary = topStation
      ? `MAX： ${escapeHtml(topStation.station_name)}（${escapeHtml(topStation.district)}） ${formatRainfall(topStation.rainfall_24h_mm)}`
      : "目前沒有可顯示的雨量資料。";

    panelMeta.innerHTML = topSummary;
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
              <div class="district-summary-meta">${escapeHtml(record.station_name)}（${escapeHtml(record.station_id)}）</div>
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

    throw new Error("未提供資料檔路徑");
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

  function render() {
    renderPanelMeta(rainfallStations);
    renderDistrictLeaders(rainfallStations);
    renderRanking(rainfallStations);
  }

  async function loadAndRender(customUrl, options = {}) {
    rainfallPayload = await fetchRainfallPayload(customUrl);
    rainfallStations = normalizePayload(rainfallPayload);

    if (rainfallStations.length === 0) {
      throw new Error("雨量 JSON 內沒有有效的 data 資料");
    }

    const value = toDateTimeLocalValue(rainfallPayload?.requested_time);
    if (value) {
      setPickerFromDateTimeLocal(value);
    }

    render();
  }

  async function initRainfallPanel() {
    fillTimeSelectors();

    const defaultQueryDate = floorToTenMinutes(new Date());
    const defaultQueryLocal = dateToDateTimeLocal(defaultQueryDate);
    const defaultDataUrl = buildDataUrlByStamp(dateToFileStamp(defaultQueryDate));

    setPickerFromDate(defaultQueryDate);

    try {
      await loadAndRender(defaultDataUrl, { queryTime: defaultQueryLocal });
    } catch (error) {
      try {
        const nearest = await findNearestAvailableDataUrl(defaultQueryDate);
        await loadAndRender(nearest.url, { queryTime: dateToDateTimeLocal(nearest.date) });
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
    const selectedTime = normalizeDateTimeLocalToTenMinutes(getSelectedDateTimeLocal());

    if (selectedTime) {
      setPickerFromDateTimeLocal(selectedTime);
    }

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