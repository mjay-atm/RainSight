const map = L.map("map", { zoomControl: true });

// Base Layers
const osmLayer = L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  maxZoom: 19
});

const emptyLayer = L.tileLayer("", {
  attribution: "",
  maxZoom: 19
}).addTo(map);

// Overlay Groups
const stationsLayer = L.layerGroup().addTo(map);
const maskLayer = L.layerGroup().addTo(map); // Focus Mode
const townLayer = L.geoJSON(null, {
  style: {
    color: "#666",
    weight: 1,
    fill: false,
    dashArray: "5, 5"
  },
  onEachFeature: function(feature, layer) {
    const townName = feature.properties.TOWNNAME;
    const shortName = townName.replace(/[鄉鎮市區]$/, "");
    const center = layer.getBounds().getCenter();

    const labelIcon = L.divIcon({
      className: "town-label-marker",
      html: `<div class="town-label">${shortName}</div>`,
      iconSize: [40, 20],
      iconAnchor: [20, 10]
    });

    L.marker(center, {
      icon: labelIcon,
      interactive: false
    }).addTo(map);
  }
}).addTo(map);

const districtBoundaryLayer = L.geoJSON(null, {
  style: {
    color: "#334155",
    weight: 2,
    fillColor: "#60a5fa",
    fillOpacity: 0.08
  }
}).addTo(map);

const agencyColors = {
  CWA: "#2563eb",
  WRG_TYCG: "#f59e0b",
  WRA: "#16a34a"
};

const defaultColor = "#64748b";
const markerLayer = L.layerGroup().addTo(map);
const meta = document.getElementById("meta");
const districtFilter = document.getElementById("districtFilter");

let allStations = [];
let districtFeatures = new Map();
let townFeatures = [];

const defaultBoundaryStyle = {
  color: "#334155",
  weight: 2,
  fillColor: "#60a5fa",
  fillOpacity: 0.08
};

function elevationText(value) {
  return value === null || value === undefined ? "無資料" : `${value} m`;
}

function sourceText(station) {
  if (station.sourceUrl) {
    return `<a href="${station.sourceUrl}" target="_blank" rel="noopener noreferrer">資料來源連結</a>`;
  }
  return "無";
}

function buildPopup(station) {
  return `
    <h2 class="popup-title">${station.stationName}</h2>
    <dl class="popup-grid">
      <dt>站號</dt><dd>${station.stationId}</dd>
      <dt>機構</dt><dd>${station.agency}</dd>
      <dt>測站類型</dt><dd>${station.stationType}</dd>
      <dt>行政區</dt><dd>${station.county}${station.district}</dd>
      <dt>海拔</dt><dd>${elevationText(station.elevation)}</dd>
      <dt>座標</dt><dd>${station.latitude.toFixed(6)}, ${station.longitude.toFixed(6)}</dd>
      <dt>來源</dt><dd>${sourceText(station)}</dd>
    </dl>
  `;
}

function countByAgency(stations) {
  return stations.reduce((acc, station) => {
    acc[station.agency] = (acc[station.agency] || 0) + 1;
    return acc;
  }, {});
}

function updateMeta(visibleStations, totalStations) {
  const counts = countByAgency(visibleStations);
  meta.innerHTML = `顯示 ${visibleStations.length} / ${totalStations} 個測站` +
    Object.entries(counts)
      .map(([agency, count]) => {
        const color = agencyColors[agency] || defaultColor;
        return `<span class="badge"><span class="dot" style="background:${color}"></span>${agency}: ${count}</span>`;
      })
      .join("");
}

function normalizeCountyName(name) {
  if (typeof name !== "string") {
    return "";
  }
  return name.trim();
}

function normalizeDistrictName(name) {
  if (typeof name !== "string") {
    return "";
  }
  return name.trim();
}

async function loadDistrictBoundaries(stations) {
  const targetDistricts = new Set(
    stations
      .map((station) => normalizeDistrictName(station.district))
      .filter(Boolean)
  );

  try {
    const response = await fetch("./data/taoyuan_towns_moi.json");
    if (!response.ok) {
      throw new Error(`讀取行政區邊界資料失敗 (${response.status})`);
    }

    const geojson = await response.json();
    const features = Array.isArray(geojson.features) ? geojson.features : [];
    const filteredFeatures = features.filter((feature) => {
      const props = feature?.properties || {};
      const townName = normalizeDistrictName(props.TOWNNAME);
      return targetDistricts.has(townName);
    });

    districtFeatures = new Map(
      filteredFeatures.map((feature) => [normalizeDistrictName(feature.properties?.TOWNNAME), feature])
    );

    // Store town features for mask creation
    townFeatures = features;
  } catch (error) {
    console.warn("Failed to load district boundaries:", error);
    districtFeatures = new Map();
    townFeatures = [];
  }
}

function renderDistrictBoundaries(selectedDistrict) {
  districtBoundaryLayer.clearLayers();
  districtBoundaryLayer.setStyle(defaultBoundaryStyle);

  if (selectedDistrict === "ALL") {
    const allFeatures = [...districtFeatures.values()];
    if (allFeatures.length > 0) {
      districtBoundaryLayer.addData({ type: "FeatureCollection", features: allFeatures });
    }
    return;
  }

  const selectedFeature = districtFeatures.get(selectedDistrict);
  if (!selectedFeature) {
    return;
  }

  districtBoundaryLayer.addData(selectedFeature);
  districtBoundaryLayer.setStyle({
    color: "#1d4ed8",
    weight: 3,
    fillColor: "#60a5fa",
    fillOpacity: 0.14
  });
}

function fitMapToSelection(selectedDistrict, stationsToRender) {
  if (selectedDistrict !== "ALL") {
    const selectedFeature = districtFeatures.get(selectedDistrict);
    if (selectedFeature) {
      const tempLayer = L.geoJSON(selectedFeature);
      const boundaryBounds = tempLayer.getBounds();
      if (boundaryBounds.isValid()) {
        map.fitBounds(boundaryBounds, { padding: [24, 24] });
        return;
      }
    }
  }

  const stationBounds = [];
  stationsToRender.forEach((station) => {
    if (typeof station.latitude === "number" && typeof station.longitude === "number") {
      stationBounds.push([station.latitude, station.longitude]);
    }
  });

  if (stationBounds.length > 0) {
    map.fitBounds(stationBounds, { padding: [24, 24], maxZoom: 14 });
  } else {
    map.setView([24.99, 121.25], 11);
  }
}

function renderStations(stationsToRender, totalStations, selectedDistrict) {
  markerLayer.clearLayers();

  stationsToRender.forEach((station) => {
    if (typeof station.latitude !== "number" || typeof station.longitude !== "number") {
      return;
    }

    const color = agencyColors[station.agency] || defaultColor;
    const marker = L.circleMarker([station.latitude, station.longitude], {
      radius: 6,
      color,
      fillColor: color,
      fillOpacity: 0.75,
      weight: 1
    }).addTo(markerLayer);

    marker.bindTooltip(`${station.stationName}（${station.stationId}）`, {
      sticky: false,
      direction: "top",
      offset: [0, -6]
    });
    marker.bindPopup(buildPopup(station), { maxWidth: 360 });
  });

  renderDistrictBoundaries(selectedDistrict);
  fitMapToSelection(selectedDistrict, stationsToRender);

  updateMeta(stationsToRender, totalStations);
}

function setupDistrictFilter(stations) {
  const districts = [...new Set(stations.map((station) => station.district).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, "zh-Hant"));

  districtFilter.innerHTML = `<option value="ALL">全部</option>` +
    districts.map((district) => `<option value="${district}">${district}</option>`).join("");

  districtFilter.addEventListener("change", () => {
    const selectedDistrict = districtFilter.value;
    const filteredStations = selectedDistrict === "ALL"
      ? allStations
      : allStations.filter((station) => station.district === selectedDistrict);

    renderStations(filteredStations, allStations.length, selectedDistrict);
  });
}

function setupLayerControl() {
  const baseMaps = {
    "OpenStreetMap": osmLayer,
    "無地圖 (White)": emptyLayer
  };

  const overlayMaps = {
    "鄉鎮市區界線": townLayer,
    "地面測站": stationsLayer,
    "僅桃園 (Focus Mode)": maskLayer
  };

  L.control.layers(baseMaps, overlayMaps).addTo(map);
}

function createFocusMask() {
  try {
    if (townFeatures.length === 0) {
      return;
    }

    // Create union of all town features
    const fc = {
      type: "FeatureCollection",
      features: townFeatures.map(f => ({
        type: "Feature",
        geometry: f.geometry
      }))
    };

    let union = null;
    for (const feature of fc.features) {
      if (union === null) {
        union = feature;
      } else {
        try {
          union = turf.union(union, feature);
        } catch (e) {
          console.warn("Turf union failed for some features:", e);
        }
      }
    }

    if (!union) {
      return;
    }

    // Create world polygon minus union
    const worldBounds = [
      [[-180, -90], [-180, 90], [180, 90], [180, -90], [-180, -90]]
    ];
    const world = {
      type: "Feature",
      geometry: {
        type: "Polygon",
        coordinates: worldBounds
      }
    };

    // Use difference to create mask
    let mask = world;
    try {
      mask = turf.difference(world, union);
    } catch (e) {
      console.warn("Turf difference failed:", e);
      return;
    }

    if (mask && mask.geometry) {
      L.geoJSON(mask, {
        style: {
          color: "rgba(200, 200, 200, 0.6)",
          weight: 0,
          fillColor: "rgba(200, 200, 200, 0.6)",
          fillOpacity: 0.6
        },
        interactive: false
      }).addTo(maskLayer);
    }
  } catch (error) {
    console.warn("Failed to create focus mask:", error);
  }
}

// Load town boundaries for labeling
async function loadTownLayer() {
  try {
    const response = await fetch("./data/taoyuan_towns_moi.json");
    if (!response.ok) {
      throw new Error(`讀取鄉鎮市區資料失敗 (${response.status})`);
    }
    const geojson = await response.json();
    townLayer.addData(geojson);
    townFeatures = geojson.features || [];
    createFocusMask();
  } catch (error) {
    console.warn("Failed to load town layer:", error);
  }
}

async function init() {
  try {
    const response = await fetch("./station.json");
    if (!response.ok) {
      throw new Error(`讀取 station.json 失敗 (${response.status})`);
    }

    const data = await response.json();
    const stations = Array.isArray(data.stations) ? data.stations : [];

    if (stations.length === 0) {
      throw new Error("station.json 內沒有 stations 資料");
    }

    allStations = stations;
    await loadDistrictBoundaries(allStations);
    setupDistrictFilter(allStations);
    setupLayerControl();
    await loadTownLayer();
    renderStations(allStations, allStations.length, "ALL");
  } catch (error) {
    map.setView([24.99, 121.25], 11);
    meta.textContent = `載入失敗：${error.message}。請以本機伺服器方式開啟此頁（例如 python -m http.server）。`;
  }
}

init();
