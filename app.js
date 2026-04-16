(function () {
  function fail(message, error) {
    console.error(message, error || "");
    alert(message);
  }

  if (!window.APP_CONFIG) {
    fail("Hiányzik a config.js vagy nincs betöltve a window.APP_CONFIG.");
    return;
  }

  const {
    SUPABASE_URL,
    SUPABASE_ANON_KEY,
    SUPABASE_PUBLISHABLE_KEY,
    MAP_IMAGE,
    MAP_WIDTH,
    MAP_HEIGHT,
    ICONS
  } = window.APP_CONFIG;

  const SUPABASE_KEY = SUPABASE_PUBLISHABLE_KEY || SUPABASE_ANON_KEY;

  if (!window.supabase) {
    fail("A Supabase library nem töltődött be.");
    return;
  }

  if (!window.L) {
    fail("A Leaflet library nem töltődött be.");
    return;
  }

  if (!SUPABASE_URL || !SUPABASE_KEY) {
    fail("Hiányzik a SUPABASE_URL vagy a SUPABASE kulcs a config.js-ből.");
    return;
  }

  if (!MAP_IMAGE) {
    fail("Hiányzik a MAP_IMAGE a config.js-ből.");
    return;
  }

  const mapElement = document.getElementById("map");
  if (!mapElement) {
    fail("Nem található a #map elem az oldalon.");
    return;
  }

  const zoneColorEl = document.getElementById("zoneColor");
  const zoneLabelEl = document.getElementById("zoneLabel");
  const markerTypeEl = document.getElementById("markerType");
  const markerLabelEl = document.getElementById("markerLabel");
  const reloadButton = document.getElementById("reloadData");
  const clearSelectionButton = document.getElementById("clearLocalSelection");
  const toolButtons = document.querySelectorAll(".tool-button");

  if (!zoneColorEl || !zoneLabelEl || !markerTypeEl || !markerLabelEl) {
    fail("Hiányoznak szükséges form elemek az index.html-ből.");
    return;
  }

  const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

  let currentMode = "pan";
  let map = null;
  let zoneLayerGroup = null;
  let markerLayerGroup = null;

  function escapeHtml(text) {
    if (!text) return "";
    return String(text)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function setMode(mode) {
    currentMode = mode;

    toolButtons.forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.mode === mode);
    });

    if (!map) return;

    if (mode === "pan" || mode === "inspect") {
      map.dragging.enable();
    } else {
      map.dragging.disable();
    }
  }

  function getZoneStyle(color) {
    switch (color) {
      case "green":
        return { color: "#1f8f45", fillColor: "#2ecc71", fillOpacity: 0.28, weight: 2 };
      case "yellow":
        return { color: "#b58b00", fillColor: "#f1c40f", fillOpacity: 0.28, weight: 2 };
      case "red":
        return { color: "#b93232", fillColor: "#e74c3c", fillOpacity: 0.28, weight: 2 };
      default:
        return { color: "#888", fillColor: "#aaa", fillOpacity: 0.20, weight: 2 };
    }
  }

  function buildZoneRectangle(zone) {
    const rectBounds = [
      [zone.y, zone.x],
      [zone.y + zone.height, zone.x + zone.width]
    ];

    const rect = L.rectangle(rectBounds, getZoneStyle(zone.color));

    const popupHtml = `
      <div class="zone-label-popup">
        <strong>Zóna</strong><br>
        Szín: ${escapeHtml(zone.color)}<br>
        ${zone.label ? `Leírás: ${escapeHtml(zone.label)}<br>` : ""}
        <button onclick="deleteZone(${zone.id})">Törlés</button>
      </div>
    `;

    rect.bindPopup(popupHtml);
    return rect;
  }

  function buildMarker(marker) {
    const iconMap = ICONS || {};
    const iconUrl = iconMap[marker.icon_type] || iconMap.loot || "";

    let markerOptions = {};

    if (iconUrl) {
      const customIcon = L.divIcon({
        className: "custom-div-icon",
        html: `<img class="custom-marker-icon" src="${iconUrl}" alt="${escapeHtml(marker.icon_type)}" />`,
        iconSize: [28, 28],
        iconAnchor: [14, 14],
        popupAnchor: [0, -12]
      });

      markerOptions.icon = customIcon;
    }

    const leafletMarker = L.marker([marker.y, marker.x], markerOptions);

    const popupHtml = `
      <div class="zone-label-popup">
        <strong>Ikon</strong><br>
        Típus: ${escapeHtml(marker.icon_type)}<br>
        ${marker.label ? `Leírás: ${escapeHtml(marker.label)}<br>` : ""}
        <button onclick="deleteMarker(${marker.id})">Törlés</button>
      </div>
    `;

    leafletMarker.bindPopup(popupHtml);
    return leafletMarker;
  }

  async function loadZones() {
    zoneLayerGroup.clearLayers();

    const { data, error } = await supabase
      .from("zones")
      .select("*")
      .order("id", { ascending: true });

    if (error) {
      console.error("Hiba a zónák betöltésekor:", error);
      alert("Nem sikerült betölteni a zónákat.");
      return;
    }

    (data || []).forEach((zone) => {
      buildZoneRectangle(zone).addTo(zoneLayerGroup);
    });
  }

  async function loadMarkers() {
    markerLayerGroup.clearLayers();

    const { data, error } = await supabase
      .from("markers")
      .select("*")
      .order("id", { ascending: true });

    if (error) {
      console.error("Hiba az ikonok betöltésekor:", error);
      alert("Nem sikerült betölteni az ikonokat.");
      return;
    }

    (data || []).forEach((marker) => {
      buildMarker(marker).addTo(markerLayerGroup);
    });
  }

  async function reloadAllData() {
    await Promise.all([loadZones(), loadMarkers()]);
  }

  async function createZone(latlng) {
    const zoneSize = 180;
    const color = zoneColorEl.value;
    const label = zoneLabelEl.value.trim();

    const payload = {
      x: latlng.lng - zoneSize / 2,
      y: latlng.lat - zoneSize / 2,
      width: zoneSize,
      height: zoneSize,
      color,
      label
    };

    const { error } = await supabase.from("zones").insert(payload);

    if (error) {
      console.error("Hiba a zóna mentésekor:", error);
      alert("Nem sikerült elmenteni a zónát.");
      return;
    }

    await loadZones();
  }

  async function createMarker(latlng) {
    const icon_type = markerTypeEl.value;
    const label = markerLabelEl.value.trim();

    const payload = {
      x: latlng.lng,
      y: latlng.lat,
      icon_type,
      label
    };

    const { error } = await supabase.from("markers").insert(payload);

    if (error) {
      console.error("Hiba az ikon mentésekor:", error);
      alert("Nem sikerült elmenteni az ikont.");
      return;
    }

    await loadMarkers();
  }

  window.deleteZone = async function (id) {
    const confirmed = confirm("Biztos törlöd ezt a zónát?");
    if (!confirmed) return;

    const { error } = await supabase.from("zones").delete().eq("id", id);
    if (error) {
      console.error("Hiba a zóna törlésekor:", error);
      alert("Nem sikerült törölni a zónát.");
      return;
    }

    await loadZones();
  };

  window.deleteMarker = async function (id) {
    const confirmed = confirm("Biztos törlöd ezt az ikont?");
    if (!confirmed) return;

    const { error } = await supabase.from("markers").delete().eq("id", id);
    if (error) {
      console.error("Hiba az ikon törlésekor:", error);
      alert("Nem sikerült törölni az ikont.");
      return;
    }

    await loadMarkers();
  };

  function bindUiEvents() {
    toolButtons.forEach((button) => {
      button.addEventListener("click", () => setMode(button.dataset.mode));
    });

    if (reloadButton) {
      reloadButton.addEventListener("click", reloadAllData);
    }

    if (clearSelectionButton) {
      clearSelectionButton.addEventListener("click", () => {
        zoneLabelEl.value = "";
        markerLabelEl.value = "";
      });
    }
  }

  async function initMap() {
    const img = new Image();

    return new Promise((resolve, reject) => {
      img.onload = () => {
        const width = MAP_WIDTH || img.naturalWidth;
        const height = MAP_HEIGHT || img.naturalHeight;
        const bounds = [[0, 0], [height, width]];

        map = L.map("map", {
          crs: L.CRS.Simple,
          minZoom: -2,
          maxZoom: 2,
          zoomSnap: 0.25
        });

        L.imageOverlay(MAP_IMAGE, bounds).addTo(map);
        map.fitBounds(bounds);

        zoneLayerGroup = L.layerGroup().addTo(map);
        markerLayerGroup = L.layerGroup().addTo(map);

        map.on("click", async (event) => {
          if (currentMode === "zone") {
            await createZone(event.latlng);
          }

          if (currentMode === "marker") {
            await createMarker(event.latlng);
          }
        });

        window.addEventListener("resize", () => {
          if (map) {
            setTimeout(() => map.invalidateSize(), 100);
          }
        });

        setTimeout(() => map.invalidateSize(), 100);

        resolve();
      };

      img.onerror = () => {
        reject(new Error(`Nem sikerült betölteni a térképképet: ${MAP_IMAGE}`));
      };

      img.src = MAP_IMAGE;
    });
  }

  (async function init() {
    try {
      bindUiEvents();
      await initMap();
      setMode("pan");
      await reloadAllData();
    } catch (error) {
      fail("Hiba történt az alkalmazás indításakor.", error);
    }
  })();
})();