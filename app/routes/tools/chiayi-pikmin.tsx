import { useEffect, useMemo, useState } from "react";

type StopArea = "gateway" | "A" | "B" | "C";

type Stop = {
  id: string;
  time: string;
  type: string;
  title: string;
  desc: string;
  reward: string;
  suggestion: string;
  note: string;
  mapQuery: string;
  area: StopArea;
  mission?: boolean;
  locked?: boolean;
  durationMin: number;
  stay: string;
  travelFromPreviousMin?: number;
  attachments: Array<{ label: string; url: string }>;
};

const STORAGE_KEY = "chiayi-pikmin-demo-completed";
const ORDER_STORAGE_KEY = "chiayi-pikmin-demo-order";
const officialEventUrl = "https://pikminbloom.com/zh/news/may26-chiayiartsfestivalminiwalk";
const pikminImages = [
  "/chiayi-pikmin/red-pikmin.webp",
  "/chiayi-pikmin/yellow-pikmin.webp",
  "/chiayi-pikmin/blue-pikmin.webp",
  "/chiayi-pikmin/purple-pikmin.webp",
];

const trainInfo = {
  outbound: "609｜台北 07:46 → 嘉義 09:13",
  inbound: "678｜嘉義 19:32 → 台北 20:59",
};

const areaLabels: Record<StopArea, string> = {
  gateway: "高鐵/BRT",
  A: "A 車站西側",
  B: "B 北門藝文",
  C: "C 東門/文化路",
};

function mapSearchUrl(query: string) {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}

const stops: Stop[] = [
  {
    id: "hsr",
    time: "09:13",
    type: "高鐵 / BRT",
    title: "高鐵 609 抵達嘉義 / BRT 進市區",
    desc: "",
    reward: "抵嘉整備",
    suggestion: "到站後接 BRT 進嘉義市區；市區段再切 Ubike。",
    note: "票面時間是 609，台北 07:46 → 嘉義 09:13。",
    mapQuery: "嘉義高鐵站",
    area: "gateway",
    locked: true,
    durationMin: 0,
    stay: "09:13",
    travelFromPreviousMin: 0,
    attachments: [
      { label: "前往市區", url: mapSearchUrl("嘉義高鐵站 到 嘉義文化創意產業園區") },
    ],
  },
  {
    id: "art-museum",
    time: "09:45",
    type: "踩點 / 逛展",
    title: "嘉義市立美術館",
    desc: "可領金色花苗與明信片。",
    reward: "美術館 Decor",
    suggestion: "看古蹟棟與本館的新舊對照：1936 年原菸酒公賣局嘉義分局、弧形轉角、水平窗帶、SCRATCH 磁磚，以及後來增建的玻璃盒子與木構語彙。",
    note: "官網參觀資訊標示開館 09:00-17:00；當日展覽、售票與休館仍以美術館公告為準。",
    mapQuery: "嘉義市立美術館",
    area: "A",
    mission: true,
    durationMin: 85,
    stay: "09:45-11:15",
    travelFromPreviousMin: 35,
    attachments: [
      { label: "Google 地點", url: mapSearchUrl("嘉義市立美術館") },
      { label: "美術館官網", url: "https://chiayiartmuseum.chiayi.gov.tw/" },
    ],
  },
  {
    id: "lunch",
    time: "11:20",
    type: "補給",
    title: "午餐 / 冷氣休息",
    desc: "",
    reward: "體力回復",
    suggestion: "冷氣、坐得下、補水，這站的任務只有恢復體力。",
    note: "這不是踩點站；若不餓可以改成咖啡或飲料休息。",
    mapQuery: "嘉義市 午餐 冷氣",
    area: "A",
    durationMin: 75,
    stay: "11:18-12:33",
    travelFromPreviousMin: 5,
    attachments: [
      { label: "午餐候選", url: mapSearchUrl("嘉義市 午餐 冷氣") },
      { label: "附近咖啡", url: mapSearchUrl("嘉義市立美術館 附近 咖啡") },
    ],
  },
  {
    id: "creative-park",
    time: "13:00",
    type: "踩點 / 市集",
    title: "嘉義文化創意產業園區",
    desc: "可領金色花苗與明信片。",
    reward: "彩繪 Decor",
    suggestion: "舊酒廠再利用園區，先拿 Pikmin 點位，再看創藝市集、品牌活動、展覽表演與園區建築。",
    note: "官網標示戶外空間 24 小時開放，店家與活動依各自公告；市集有無與時間以園區當日公告/社群為準。",
    mapQuery: "嘉義文化創意產業園區",
    area: "A",
    mission: true,
    durationMin: 60,
    stay: "13:00-14:00",
    travelFromPreviousMin: 8,
    attachments: [
      { label: "Google 地點", url: mapSearchUrl("嘉義文化創意產業園區") },
      { label: "活動資訊", url: officialEventUrl },
    ],
  },
  {
    id: "city-museum",
    time: "14:25",
    type: "踩點 / 逛展",
    title: "嘉義市立博物館",
    desc: "可領金色花苗與明信片。",
    reward: "禮物貼紙（金色）Decor",
    suggestion: "把它當城市博物館看：官網目前列出諸羅城、嘉義工藝、兒童策展、火雞肉飯等在地題材；選 1-2 個主題慢看，比每區都掃過有感。",
    note: "部分特展可能售票或依檔期調整；現場展覽、票價與開放空間以館方公告為準。",
    mapQuery: "嘉義市立博物館",
    area: "B",
    mission: true,
    durationMin: 55,
    stay: "14:20-15:15",
    travelFromPreviousMin: 20,
    attachments: [
      { label: "Google 地點", url: mapSearchUrl("嘉義市立博物館") },
      { label: "博物館官網", url: "https://museum.chiayi.gov.tw/" },
    ],
  },
  {
    id: "wood-lab",
    time: "15:45",
    type: "踩點",
    title: "嘉義製材所園區 / 嘉義實驗木場",
    desc: "可領金色花苗與明信片。",
    reward: "五金行 Decor",
    suggestion: "看阿里山林業在市區留下的產業現場：製材工場、動力室、鋸屑室、乾燥室，理解嘉義「木都」怎麼從阿里山鐵道接到市區。",
    note: "以戶外與歷史建築為主；雨天或高溫時現場體感會明顯影響停留品質。",
    mapQuery: "嘉義製材所園區 嘉義實驗木場",
    area: "B",
    mission: true,
    durationMin: 10,
    stay: "15:20-15:30",
    travelFromPreviousMin: 5,
    attachments: [
      { label: "Google 地點", url: mapSearchUrl("嘉義製材所園區 嘉義實驗木場") },
      { label: "活動資訊", url: officialEventUrl },
    ],
  },
  {
    id: "literature-museum",
    time: "15:50",
    type: "踩點",
    title: "嘉義文學館：東門町1923",
    desc: "可領金色花苗與明信片。",
    reward: "圖書館 Decor",
    suggestion: "看百年東門派出所再生的文學基地；2026 首展《球者魂也：嘉義棒球文學特展》把展場做成球場，用文學看 KANO 與嘉義棒球原鄉。",
    note: "《球者魂也》公開資訊標示展期至 2026/07/12；實際開館與入場以嘉義文學館公告為準。",
    mapQuery: "嘉義文學館 東門町1923",
    area: "C",
    mission: true,
    durationMin: 15,
    stay: "15:50-16:05",
    travelFromPreviousMin: 20,
    attachments: [
      { label: "Google 地點", url: mapSearchUrl("嘉義文學館 東門町1923") },
      { label: "活動資訊", url: officialEventUrl },
    ],
  },
  {
    id: "baseball-stadium",
    time: "16:10",
    type: "踩點",
    title: "嘉義市立棒球場",
    desc: "可領金色花苗與明信片。",
    reward: "體育館 Decor",
    suggestion: "外圍看嘉義棒球脈絡與 KANO 記憶；嘉義市立棒球場源自日治時期公園球場，和嘉義「棒球原鄉」形象很直接。",
    note: "若沒有比賽或活動，不預設能入場參觀；以外圍與周邊公共空間為主。",
    mapQuery: "嘉義市立棒球場",
    area: "C",
    mission: true,
    durationMin: 10,
    stay: "16:10-16:20",
    travelFromPreviousMin: 5,
    attachments: [
      { label: "Google 地點", url: mapSearchUrl("嘉義市立棒球場") },
      { label: "活動資訊", url: officialEventUrl },
    ],
  },
  {
    id: "culture-park",
    time: "16:25",
    type: "踩點",
    title: "文化公園",
    desc: "可領金色花苗與明信片。",
    reward: "公園（四葉幸運草）Decor",
    suggestion: "5/30-5/31 15:00-21:00 官方地圖與遮陽帽發放攤位在這裡；有到攤位就先確認領取規則。",
    note: "官方公告說實體攤位只在 5/30-5/31 15:00-21:00；不在攤位時段也仍可玩遊戲 Special Spot。",
    mapQuery: "嘉義文化公園",
    area: "C",
    mission: true,
    durationMin: 10,
    stay: "16:25-16:35",
    travelFromPreviousMin: 5,
    attachments: [
      { label: "Google 地點", url: mapSearchUrl("嘉義文化公園") },
      { label: "官方活動公告", url: officialEventUrl },
    ],
  },
  {
    id: "central-market",
    time: "16:40",
    type: "踩點",
    title: "嘉義中央第一商場",
    desc: "可領金色花苗與明信片。",
    reward: "服裝店 Decor",
    suggestion: "拿服裝店 Decor，順便看商場與文化路周邊街區氛圍。",
    note: "中央第一商場屬市中心商場環境，傍晚周邊人流通常會增加。",
    mapQuery: "嘉義中央第一商場",
    area: "C",
    mission: true,
    durationMin: 5,
    stay: "16:40-16:45",
    travelFromPreviousMin: 5,
    attachments: [
      { label: "Google 地點", url: mapSearchUrl("嘉義中央第一商場") },
      { label: "前往文化路", url: mapSearchUrl("嘉義中央第一商場 到 文化路夜市") },
    ],
  },
  {
    id: "wenhua-dinner",
    time: "17:00",
    type: "晚餐",
    title: "文化路夜市 / 文化路晚餐",
    desc: "",
    reward: "晚餐收束",
    suggestion: "吃飯、休息、整理戰利品。",
    note: "文化路晚餐店家選擇多；熱門店可能需要排隊。",
    mapQuery: "嘉義文化路夜市",
    area: "C",
    locked: true,
    durationMin: 90,
    stay: "17:00-18:30",
    travelFromPreviousMin: 5,
    attachments: [
      { label: "晚餐地圖", url: mapSearchUrl("嘉義文化路夜市 晚餐") },
      { label: "甜點飲料", url: mapSearchUrl("嘉義文化路夜市 甜點 飲料") },
    ],
  },
  {
    id: "return-brt",
    time: "18:45",
    type: "BRT 返程",
    title: "文化路 / 嘉義市區 → 高鐵嘉義站",
    desc: "",
    reward: "返程緩衝",
    suggestion: "回高鐵站，保守抓候車、進站與走路時間。",
    note: "回程高鐵 678 是嘉義 19:32 發車；這段預設 18:45 出發、約 19:20 到站。",
    mapQuery: "嘉義文化路夜市 到 高鐵嘉義站",
    area: "gateway",
    locked: true,
    durationMin: 35,
    stay: "18:45-19:20",
    travelFromPreviousMin: 40,
    attachments: [
      { label: "返程地圖", url: mapSearchUrl("嘉義文化路夜市 到 高鐵嘉義站") },
    ],
  },
  {
    id: "return-train",
    time: "19:32",
    type: "高鐵回程",
    title: "高鐵 678｜嘉義 → 台北",
    desc: "",
    reward: "回台北",
    suggestion: "19:32 從嘉義上車，20:59 抵達台北。",
    note: "票面資訊：2026/05/30，嘉義 19:32 → 台北 20:59。",
    mapQuery: "高鐵嘉義站",
    area: "gateway",
    locked: true,
    durationMin: 0,
    stay: "19:32",
    travelFromPreviousMin: 0,
    attachments: [
      { label: "高鐵嘉義站", url: mapSearchUrl("高鐵嘉義站") },
    ],
  },
];

export function meta() {
  return [
    { title: "嘉義皮克敏踩點行程" },
    {
      name: "description",
      content: "以嘉義皮克敏 8 個特殊地點與展館停留為主的半日行程。",
    },
  ];
}

function getStoredCompleted() {
  if (typeof window === "undefined") return new Set<string>();
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : []);
  } catch {
    return new Set<string>();
  }
}

function getDefaultOrder() {
  return stops.map((stop) => stop.id);
}

function getStoredOrder() {
  if (typeof window === "undefined") return getDefaultOrder();
  try {
    const defaultOrder = getDefaultOrder();
    const raw = window.localStorage.getItem(ORDER_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return defaultOrder;
    const validIds = new Set(defaultOrder);
    const ordered = parsed.filter((item): item is string => typeof item === "string" && validIds.has(item));
    const missing = defaultOrder.filter((id) => !ordered.includes(id));
    const merged = [...ordered, ...missing];
    const lockedPositionsOk = stops.every((stop) => !stop.locked || merged.indexOf(stop.id) === defaultOrder.indexOf(stop.id));
    return lockedPositionsOk ? merged : defaultOrder;
  } catch {
    return getDefaultOrder();
  }
}

function saveOrder(next: string[]) {
  window.localStorage.setItem(ORDER_STORAGE_KEY, JSON.stringify(next));
}

function currentLocationRouteUrl(stop: Stop) {
  const travelMode = stop.area === "gateway" ? "transit" : "bicycling";
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(stop.mapQuery)}&travelmode=${travelMode}`;
}

function fullRouteUrl(routeStops: Stop[]) {
  const origin = routeStops[0];
  const destination = routeStops[routeStops.length - 1];
  const waypoints = routeStops.slice(1, -1).map((stop) => stop.mapQuery).join("|");
  return `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(origin.mapQuery)}&destination=${encodeURIComponent(destination.mapQuery)}&waypoints=${encodeURIComponent(waypoints)}&travelmode=bicycling`;
}

function timeToMinutes(time: string) {
  const [hours, minutes] = time.split(":").map(Number);
  return hours * 60 + minutes;
}

function minutesToTime(totalMinutes: number) {
  const normalized = ((totalMinutes % 1440) + 1440) % 1440;
  const hours = Math.floor(normalized / 60).toString().padStart(2, "0");
  const minutes = (normalized % 60).toString().padStart(2, "0");
  return `${hours}:${minutes}`;
}

function formatDuration(minutes: number) {
  const abs = Math.abs(minutes);
  const hours = Math.floor(abs / 60);
  const mins = abs % 60;
  if (hours === 0) return `${mins} 分`;
  if (mins === 0) return `${hours} 小時`;
  return `${hours} 小時 ${mins} 分`;
}

function estimateTravelMinutes(from?: Stop, to?: Stop) {
  if (!from || !to || from.id === to.id) return 0;
  if (from.id === "hsr") return 35;
  if (to.id === "return-train") return 0;
  if (to.id === "return-brt") return 35;
  if (from.area === "gateway" || to.area === "gateway") return 35;
  if (from.area === to.area) return 5;
  const pair = new Set([from.area, to.area]);
  if (pair.has("A") && pair.has("C")) return 30;
  return 20;
}

function buildSchedule(orderedStops: Stop[]) {
  const schedule = new Map<string, { start: string; end: string; stay: string }>();
  let cursor = timeToMinutes("09:13");

  orderedStops.forEach((stop, index) => {
    const previous = orderedStops[index - 1];
    if (previous && stop.id !== "return-brt") cursor += estimateTravelMinutes(previous, stop);
    if (stop.id === "creative-park") cursor = Math.max(cursor, timeToMinutes("13:00"));
    if (stop.id === "wenhua-dinner") cursor = Math.max(cursor, timeToMinutes("17:00"));
    if (stop.id === "return-brt") cursor = Math.max(cursor, timeToMinutes("18:45"));
    if (stop.id === "return-train") cursor = Math.max(cursor, timeToMinutes("19:32"));

    const start = minutesToTime(cursor);
    const end = minutesToTime(cursor + stop.durationMin);
    const stay = stop.durationMin > 0 ? `${start}-${end}` : start;
    schedule.set(stop.id, { start, end, stay });
    cursor += stop.durationMin;
  });

  return schedule;
}

function getCurrentTimeValue() {
  const now = new Date();
  return `${now.getHours().toString().padStart(2, "0")}:${now.getMinutes().toString().padStart(2, "0")}`;
}

function saveCompleted(next: Set<string>) {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify([...next]));
}

export default function ChiayiPikminPage() {
  const [completed, setCompleted] = useState<Set<string>>(() => new Set<string>());
  const [order, setOrder] = useState<string[]>(() => getDefaultOrder());
  const [hasMounted, setHasMounted] = useState(false);
  const [currentTime, setCurrentTime] = useState("09:13");
  const [travelEstimate, setTravelEstimate] = useState(0);
  const [openStopId, setOpenStopId] = useState<string | null>(null);
  const [draggingStopId, setDraggingStopId] = useState<string | null>(null);
  const [dragOverStopId, setDragOverStopId] = useState<string | null>(null);

  useEffect(() => {
    document.title = "嘉義皮克敏踩點行程";
    setCompleted(getStoredCompleted());
    setOrder(getStoredOrder());
    setCurrentTime(getCurrentTimeValue());
    setHasMounted(true);
  }, []);

  const orderedStops = useMemo(() => {
    const stopById = new Map(stops.map((stop) => [stop.id, stop]));
    return order.map((id) => stopById.get(id)).filter((stop): stop is Stop => Boolean(stop));
  }, [order]);
  const scheduleById = useMemo(() => buildSchedule(orderedStops), [orderedStops]);
  const missionStops = useMemo(() => orderedStops.filter((stop) => stop.mission), [orderedStops]);
  const firstOpen = useMemo(
    () => orderedStops.find((stop) => stop.id !== "hsr" && !completed.has(stop.id)),
    [completed, orderedStops],
  );
  const firstOpenIndex = firstOpen ? orderedStops.findIndex((stop) => stop.id === firstOpen.id) : -1;
  const previousStop = firstOpenIndex > 0 ? orderedStops[firstOpenIndex - 1] : undefined;
  const missionProgress = hasMounted ? missionStops.filter((stop) => completed.has(stop.id)).length : 0;
  const progressPercent = (missionProgress / missionStops.length) * 100;
  const overallMap = fullRouteUrl(orderedStops);
  const nextTravelEstimate = estimateTravelMinutes(previousStop, firstOpen);
  const firstOpenSchedule = firstOpen ? scheduleById.get(firstOpen.id) : undefined;
  const scheduledMinutes = firstOpenSchedule ? timeToMinutes(firstOpenSchedule.start) : timeToMinutes("17:00");
  const nowMinutes = timeToMinutes(currentTime);
  const scheduleGap = scheduledMinutes - nowMinutes;
  const leaveGap = scheduleGap - travelEstimate;
  const targetArrival = minutesToTime(nowMinutes + travelEstimate);

  useEffect(() => {
    setTravelEstimate(nextTravelEstimate);
  }, [nextTravelEstimate, firstOpen?.id]);

  const scheduleMessage = !firstOpen
    ? "今日行程已完成"
    : scheduleGap >= 0
      ? `距表定 ${formatDuration(scheduleGap)}`
      : `已晚 ${formatDuration(scheduleGap)}`;

  const leaveMessage = !firstOpen
    ? "可以放鬆吃飯了"
    : travelEstimate <= 0
      ? "出發整備中"
      : leaveGap > 0
        ? `${formatDuration(leaveGap)} 後出發`
        : "現在該往下一站移動";

  const toggleStop = (stopId: string) => {
    setOpenStopId(null);
    setCompleted((current) => {
      const next = new Set(current);
      if (next.has(stopId)) {
        next.delete(stopId);
      } else {
        next.add(stopId);
      }
      saveCompleted(next);
      return next;
    });
  };

  const resetMission = () => {
    window.localStorage.removeItem(STORAGE_KEY);
    window.localStorage.removeItem(ORDER_STORAGE_KEY);
    setCompleted(new Set<string>());
    setOrder(getDefaultOrder());
  };

  const moveStop = (stopId: string, direction: -1 | 1) => {
    setOrder((current) => {
      const currentIndex = current.indexOf(stopId);
      if (currentIndex < 0) return current;
      const stop = stops.find((item) => item.id === stopId);
      if (!stop || stop.locked) return current;

      let targetIndex = currentIndex + direction;
      while (targetIndex >= 0 && targetIndex < current.length) {
        const targetStop = stops.find((item) => item.id === current[targetIndex]);
        if (targetStop && !targetStop.locked) {
          const next = [...current];
          [next[currentIndex], next[targetIndex]] = [next[targetIndex], next[currentIndex]];
          saveOrder(next);
          return next;
        }
        targetIndex += direction;
      }
      return current;
    });
  };

  const isReorderable = (stopId: string) => {
    const stop = stops.find((item) => item.id === stopId);
    return Boolean(stop && !stop.locked);
  };

  const reorderStop = (activeId: string, targetId: string) => {
    if (activeId === targetId || !isReorderable(activeId) || !isReorderable(targetId)) return;
    setOrder((current) => {
      const activeIndex = current.indexOf(activeId);
      const targetIndex = current.indexOf(targetId);
      if (activeIndex < 0 || targetIndex < 0) return current;
      const next = [...current];
      next.splice(activeIndex, 1);
      next.splice(targetIndex, 0, activeId);
      saveOrder(next);
      return next;
    });
  };

  const getStopIdFromPoint = (clientX: number, clientY: number) => {
    const element = document.elementFromPoint(clientX, clientY);
    return element?.closest<HTMLElement>("[data-stop-id]")?.dataset.stopId ?? null;
  };

  const canMoveStop = (stopId: string, direction: -1 | 1) => {
    const currentIndex = order.indexOf(stopId);
    const stop = stops.find((item) => item.id === stopId);
    if (currentIndex < 0 || !stop || stop.locked) return false;
    let targetIndex = currentIndex + direction;
    while (targetIndex >= 0 && targetIndex < order.length) {
      const targetStop = stops.find((item) => item.id === order[targetIndex]);
      if (targetStop && !targetStop.locked) return true;
      targetIndex += direction;
    }
    return false;
  };

  const openNextStop = () => {
    if (firstOpen) {
      window.open(currentLocationRouteUrl(firstOpen), "_blank", "noopener,noreferrer");
      return;
    }
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const syncCurrentTime = () => {
    setCurrentTime(getCurrentTimeValue());
  };

  return (
    <div className="chiayi-pikmin-page">
      <style>{chiayiPikminCss}</style>
      <main className="chiayi-pikmin-app">
        <header className="chiayi-pikmin-hero">
          <section className="chiayi-pikmin-hero-card">
            <div className="chiayi-pikmin-dashboard-top">
              <div>
                <span className="chiayi-pikmin-kicker">下一站</span>
                <strong>{firstOpen ? `${firstOpenSchedule?.start ?? firstOpen.time}｜${firstOpen.title}` : "今日踩點完成"}</strong>
              </div>
              <span className="chiayi-pikmin-progress-pill">{missionProgress}/{missionStops.length}</span>
              <button className="chiayi-pikmin-mini-btn" type="button" onClick={openNextStop}>
                <img src="/chiayi-pikmin/blue-pikmin.webp" alt="" />
                <span>導航</span>
              </button>
            </div>

            <div className="chiayi-pikmin-mission-row" aria-label="特殊地點收集進度">
              <div className="chiayi-pikmin-bar">
                <span style={{ width: `${progressPercent}%` }} />
                <div className="chiayi-pikmin-planters" aria-hidden="true">
                  {missionStops.map((stop, index) => {
                    const isFound = completed.has(stop.id);
                    const isCurrent = firstOpen?.id === stop.id;
                    const left = missionStops.length > 1 ? (index / (missionStops.length - 1)) * 100 : 0;
                    return (
                      <span
                        key={stop.id}
                        className={`chiayi-pikmin-planter ${isFound ? "found" : ""} ${isCurrent ? "current" : ""}`}
                        style={{ left: `${left}%` }}
                      >
                        <i />
                      </span>
                    );
                  })}
                </div>
              </div>
            </div>

            <div className="chiayi-pikmin-time-tool">
              <label>
                現在
                <input type="time" value={currentTime} onChange={(event) => setCurrentTime(event.target.value)} />
              </label>
              <label>
                移動
                <input
                  type="number"
                  inputMode="numeric"
                  min="0"
                  max="120"
                  value={travelEstimate}
                  onChange={(event) => setTravelEstimate(Number(event.target.value))}
                />
                <span>分</span>
              </label>
              <button type="button" onClick={syncCurrentTime}>用現在</button>
            </div>

            <div className="chiayi-pikmin-quick-read">
              <span className={scheduleGap < 0 ? "chiayi-pikmin-drift late" : "chiayi-pikmin-drift"}>{scheduleMessage}</span>
              <span>{previousStop ? `${areaLabels[previousStop.area]}→${firstOpen ? areaLabels[firstOpen.area] : ""}` : areaLabels[firstOpen?.area ?? "gateway"]}</span>
              <span>騎乘/轉乘 {travelEstimate} 分，估 {targetArrival} 到</span>
              <b>{leaveMessage}</b>
            </div>
          </section>
        </header>

        <div className="chiayi-pikmin-section-title">建議行程</div>
        <section className="chiayi-pikmin-timeline">
          {orderedStops.map((stop) => {
            const isDone = completed.has(stop.id);
            const isCurrent = firstOpen?.id === stop.id;
            const missionIndex = stop.mission ? missionStops.findIndex((missionStop) => missionStop.id === stop.id) : -1;
            const pikminSrc = missionIndex >= 0 ? pikminImages[missionIndex % pikminImages.length] : null;
            const schedule = scheduleById.get(stop.id);
            const canDrag = isReorderable(stop.id);
            return (
              <article
                key={stop.id}
                data-stop-id={stop.id}
                className={`chiayi-pikmin-stop ${isDone ? "done" : ""} ${isCurrent ? "current" : ""} ${stop.mission ? "mission" : "support"} ${draggingStopId === stop.id ? "dragging" : ""} ${dragOverStopId === stop.id ? "drag-over" : ""}`}
                onDragOver={(event) => {
                  if (!draggingStopId || !canDrag) return;
                  event.preventDefault();
                  setDragOverStopId(stop.id);
                }}
                onDrop={(event) => {
                  event.preventDefault();
                  const activeId = event.dataTransfer.getData("text/plain") || draggingStopId;
                  if (activeId) reorderStop(activeId, stop.id);
                  setDraggingStopId(null);
                  setDragOverStopId(null);
                }}
              >
                <div className="chiayi-pikmin-card">
                  <div className="chiayi-pikmin-card-main">
                    <div className="chiayi-pikmin-meta">
                      <span className="chiayi-pikmin-time">{schedule?.start ?? stop.time}</span>
                      <span className="chiayi-pikmin-tag">{stop.type}</span>
                      <span className="chiayi-pikmin-tag stay">{schedule?.stay ?? stop.stay}</span>
                      <span className="chiayi-pikmin-tag zone">{areaLabels[stop.area]}</span>
                      {isCurrent ? <span className="chiayi-pikmin-tag current-tag">下一個目標</span> : null}
                    </div>
                    <div className="chiayi-pikmin-title-row">
                      <button
                        className="chiayi-pikmin-drag-handle"
                        type="button"
                        draggable={canDrag}
                        disabled={!canDrag}
                        aria-label={canDrag ? `拖曳重排行程：${stop.title}` : `${stop.title} 固定，不可拖曳`}
                        onDragStart={(event) => {
                          if (!canDrag) return;
                          event.dataTransfer.effectAllowed = "move";
                          event.dataTransfer.setData("text/plain", stop.id);
                          setDraggingStopId(stop.id);
                        }}
                        onDragEnd={() => {
                          setDraggingStopId(null);
                          setDragOverStopId(null);
                        }}
                        onPointerDown={(event) => {
                          if (!canDrag) return;
                          event.preventDefault();
                          event.currentTarget.setPointerCapture(event.pointerId);
                          setDraggingStopId(stop.id);
                        }}
                        onPointerMove={(event) => {
                          if (!canDrag) return;
                          const targetId = getStopIdFromPoint(event.clientX, event.clientY);
                          setDragOverStopId(targetId && isReorderable(targetId) ? targetId : null);
                        }}
                        onPointerUp={(event) => {
                          if (!canDrag) return;
                          const targetId = getStopIdFromPoint(event.clientX, event.clientY);
                          if (targetId) reorderStop(stop.id, targetId);
                          setDraggingStopId(null);
                          setDragOverStopId(null);
                        }}
                        onPointerCancel={() => {
                          setDraggingStopId(null);
                          setDragOverStopId(null);
                        }}
                      >
                        <span />
                        <span />
                        <span />
                      </button>
                      <div className="chiayi-pikmin-stop-title">
                        {pikminSrc ? <img src={pikminSrc} alt="" aria-hidden="true" /> : null}
                        <h2>{stop.title}</h2>
                      </div>
                      <button
                        className="chiayi-pikmin-check"
                        type="button"
                        aria-label={`切換 ${stop.title} 完成狀態`}
                        onClick={() => toggleStop(stop.id)}
                      >
                        {isDone ? "✓" : ""}
                      </button>
                    </div>
                  </div>

                  <details
                    open={openStopId === stop.id}
                    onToggle={(event) => {
                      const isOpen = event.currentTarget.open;
                      setOpenStopId((current) => {
                        if (isOpen) return stop.id;
                        return current === stop.id ? null : current;
                      });
                    }}
                  >
                    <summary>{isCurrent ? "目前站提醒與導航" : "展開提醒與導航"}</summary>
                    <div className="chiayi-pikmin-detail-grid">
                      {stop.mission ? (
                        <div>
                          <b>遊戲目標</b>
                          {isDone ? "已完成：" : ""}Special Spot：{stop.reward}。{stop.desc}
                        </div>
                      ) : null}
                      {stop.suggestion ? (
                        <div>
                          <b>{stop.mission ? "現場看點" : "做什麼"}</b>
                          {stop.suggestion}
                        </div>
                      ) : null}
                      {stop.note ? (
                        <div>
                          <b>注意</b>
                          {stop.note}
                        </div>
                      ) : null}
                      <div className="chiayi-pikmin-reorder">
                        <span>{stop.locked ? "固定頭尾，不參與重排" : `重排後會用 ${areaLabels[stop.area]} 的區域粗估重新計時`}</span>
                        <button type="button" disabled={!canMoveStop(stop.id, -1)} onClick={() => moveStop(stop.id, -1)}>
                          提前
                        </button>
                        <button type="button" disabled={!canMoveStop(stop.id, 1)} onClick={() => moveStop(stop.id, 1)}>
                          延後
                        </button>
                      </div>
                      <div className="chiayi-pikmin-actions">
                        <a className="chiayi-pikmin-action" href={mapSearchUrl(stop.mapQuery)} target="_blank" rel="noreferrer">
                          地點
                        </a>
                        <a className="chiayi-pikmin-action primary" href={currentLocationRouteUrl(stop)} target="_blank" rel="noreferrer">
                          <img src="/chiayi-pikmin/blue-pikmin.webp" alt="" />
                          <span>從目前位置導航</span>
                        </a>
                      </div>
                    </div>
                  </details>
                </div>
              </article>
            );
          })}
        </section>

        <div className="chiayi-pikmin-section-title">安排邏輯</div>
        <section className="chiayi-pikmin-note-card">
          <p>
            <b>車票：</b>{trainInfo.outbound}；{trainInfo.inbound}。
          </p>
          <p>
            <b>長停：</b>嘉義市立美術館、嘉義文化創意產業園區、嘉義市立博物館都預留較長時間；文創園區刻意排在午後，比早上更有機會接上市集。
          </p>
          <p>
            <b>預設路線：</b>先以展館停留、17:00 文化路晚餐、18:45 返程 BRT 為基準排好；實際順序可拖曳調整，時間會依 A/B/C 分區重新粗估。
          </p>
          <p>
            <b>交通：</b>市區以 Ubike 粗估，A 車站西側、B 北門藝文、C 東門/文化路；同區抓 5 分，A-B / B-C 抓 20 分，A-C 抓 30 分，高鐵頭尾 BRT 固定處理。
          </p>
        </section>
      </main>

      <nav className="chiayi-pikmin-bottom-nav" aria-label="任務操作">
        <button className="light" type="button" onClick={resetMission}>
          重設任務
        </button>
        <a className="dark" href={overallMap} target="_blank" rel="noreferrer">
          任務地圖
        </a>
      </nav>
    </div>
  );
}

const chiayiPikminCss = `
.chiayi-pikmin-page {
  --cp-bg: #fff9df;
  --cp-card: #fffef7;
  --cp-text: #2f403f;
  --cp-muted: #71807a;
  --cp-line: #e8ddb5;
  --cp-leaf: #7fd0ca;
  --cp-leaf-dark: #2a7a78;
  --cp-leaf-soft: #e4fbf8;
  --cp-sun: #ffd45a;
  --cp-sun-soft: #fff3bd;
  --cp-red: #f06d5e;
  --cp-blue: #67a7e8;
  --cp-purple: #a887d5;
  --cp-shadow: 0 14px 34px rgba(55, 113, 111, 0.14);
  --cp-radius: 26px;
  min-height: 100vh;
  position: relative;
  color: var(--cp-text);
  background:
    radial-gradient(circle at 8% 5%, rgba(255, 216, 99, 0.5), transparent 28%),
    radial-gradient(circle at 100% 12%, rgba(127, 208, 202, 0.36), transparent 30%),
    linear-gradient(180deg, #fffdf1 0%, var(--cp-bg) 52%, #e7fbf8 100%);
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans TC", sans-serif;
}

.chiayi-pikmin-page *,
.chiayi-pikmin-page *::before,
.chiayi-pikmin-page *::after {
  box-sizing: border-box;
}

.chiayi-pikmin-app {
  position: relative;
  z-index: 1;
  width: min(430px, 100%);
  margin: 0 auto;
  padding: 8px 12px 90px;
}

.chiayi-pikmin-hero {
  position: sticky;
  top: 0;
  z-index: 100;
  padding: 8px 0 8px;
  background: linear-gradient(180deg, rgba(255,253,241,0.98), rgba(232,251,248,0.72));
  backdrop-filter: blur(16px);
}

.chiayi-pikmin-hero-card {
  position: relative;
  overflow: hidden;
  border-radius: 22px;
  padding: 9px;
  background: linear-gradient(145deg, rgba(255, 254, 247, 0.94), rgba(232, 251, 248, 0.76));
  border: 1px solid rgba(195, 232, 225, 0.92);
  box-shadow: var(--cp-shadow);
}

.chiayi-pikmin-hero-card::after {
  content: "";
  position: absolute;
  right: -30px;
  top: -20px;
  width: 130px;
  height: 130px;
  border-radius: 50%;
  background: radial-gradient(circle, rgba(127,208,202,0.45), rgba(255,212,90,0.08), rgba(255,212,90,0));
  pointer-events: none;
}

.chiayi-pikmin-dashboard-top {
  position: relative;
  z-index: 1;
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto auto;
  gap: 8px;
  align-items: center;
}

.chiayi-pikmin-dashboard-top div {
  min-width: 0;
}

.chiayi-pikmin-dashboard-top strong {
  display: block;
  margin-top: 2px;
  color: var(--cp-leaf-dark);
  font-size: 14px;
  line-height: 1.25;
  font-weight: 950;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.chiayi-pikmin-kicker {
  display: block;
  color: var(--cp-muted);
  font-size: 12px;
  font-weight: 900;
}

.chiayi-pikmin-progress-pill {
  border-radius: 999px;
  background: var(--cp-sun-soft);
  color: #6e5b15;
  font-size: 13px;
  font-weight: 950;
  padding: 8px 9px;
  white-space: nowrap;
}

.chiayi-pikmin-eyebrow {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 13px;
  color: var(--cp-muted);
  margin-bottom: 8px;
  position: relative;
  z-index: 1;
}

.chiayi-pikmin-badge {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 5px 9px;
  border-radius: 999px;
  background: var(--cp-leaf-soft);
  color: var(--cp-leaf-dark);
  font-weight: 800;
}

.chiayi-pikmin-title {
  margin: 0;
  font-size: 25px;
  line-height: 1.18;
  letter-spacing: 0;
  position: relative;
  z-index: 1;
}

.chiayi-pikmin-subtitle {
  margin: 8px 0 15px;
  color: var(--cp-muted);
  font-size: 14px;
  line-height: 1.55;
  position: relative;
  z-index: 1;
}

.chiayi-pikmin-mission-row {
  margin: 8px 0 9px;
  position: relative;
  z-index: 1;
}

.chiayi-pikmin-mission-label,
.chiayi-pikmin-mission-count {
  font-size: 13px;
}

.chiayi-pikmin-mission-label {
  color: var(--cp-muted);
}

.chiayi-pikmin-mission-count {
  color: var(--cp-leaf-dark);
  font-weight: 900;
}

.chiayi-pikmin-bar {
  position: relative;
  height: 9px;
  margin: 0 10px;
  background: #eee4b7;
  border-radius: 999px;
  overflow: visible;
}

.chiayi-pikmin-bar > span {
  display: block;
  height: 100%;
  width: 0%;
  background: linear-gradient(90deg, var(--cp-leaf), #c9ece2, var(--cp-sun));
  border-radius: inherit;
  transition: width 0.35s ease;
  overflow: hidden;
}

.chiayi-pikmin-planters {
  position: absolute;
  inset: 0;
  pointer-events: none;
}

.chiayi-pikmin-planter {
  position: absolute;
  top: 50%;
  width: 18px;
  height: 20px;
  transform: translate(-50%, -42%);
  transform-origin: 50% 80%;
  transition: transform 0.2s ease, opacity 0.2s ease;
  opacity: 0.7;
}

.chiayi-pikmin-planter::before {
  content: "";
  position: absolute;
  left: 4px;
  right: 4px;
  bottom: 0;
  height: 8px;
  border-radius: 2px 2px 5px 5px;
  background: #c58a53;
  box-shadow: inset 0 -2px 0 rgba(77, 45, 20, 0.18), 0 1px 2px rgba(47, 64, 63, 0.12);
}

.chiayi-pikmin-planter::after {
  content: "";
  position: absolute;
  left: 3px;
  right: 3px;
  bottom: 7px;
  height: 4px;
  border-radius: 999px;
  background: #8b5f35;
}

.chiayi-pikmin-planter i {
  position: absolute;
  left: 8px;
  bottom: 10px;
  width: 2px;
  height: 8px;
  border-radius: 999px;
  background: #6d8b42;
}

.chiayi-pikmin-planter i::before,
.chiayi-pikmin-planter i::after {
  content: "";
  position: absolute;
  top: 0;
  width: 7px;
  height: 5px;
  border-radius: 80% 10% 80% 10%;
  background: #9fcf65;
}

.chiayi-pikmin-planter i::before {
  right: 1px;
  transform: rotate(-34deg);
  transform-origin: right bottom;
}

.chiayi-pikmin-planter i::after {
  left: 1px;
  transform: rotate(34deg) scaleX(-1);
  transform-origin: left bottom;
}

.chiayi-pikmin-planter.found {
  opacity: 1;
  transform: translate(-50%, -48%) scale(1.08);
}

.chiayi-pikmin-planter.found::before {
  background: #d6a05a;
}

.chiayi-pikmin-planter.found i,
.chiayi-pikmin-planter.found i::before,
.chiayi-pikmin-planter.found i::after {
  background: var(--cp-leaf-dark);
}

.chiayi-pikmin-planter.current {
  transform: translate(-50%, -54%) scale(1.16);
}

.chiayi-pikmin-planter.current::before {
  outline: 2px solid rgba(255, 212, 90, 0.8);
  outline-offset: 1px;
}

.chiayi-pikmin-now-box {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 10px;
  align-items: center;
  padding: 6px 8px;
  border-radius: 14px;
  background: linear-gradient(135deg, var(--cp-sun-soft), var(--cp-leaf-soft));
  position: relative;
  z-index: 1;
}

.chiayi-pikmin-now-box small {
  display: block;
  color: var(--cp-muted);
  font-size: 12px;
  margin-bottom: 0;
}

.chiayi-pikmin-now-box strong {
  display: block;
  min-width: 0;
  font-size: 13px;
  line-height: 1.25;
}

.chiayi-pikmin-drift {
  border-radius: 999px;
  background: rgba(255,255,255,0.72);
  color: var(--cp-leaf-dark);
  font-size: 11px;
  font-weight: 900;
  padding: 5px 7px;
  white-space: nowrap;
}

.chiayi-pikmin-drift.late {
  color: #b44c3f;
  background: rgba(255, 238, 219, 0.9);
}

.chiayi-pikmin-mini-btn {
  border: 0;
  border-radius: 999px;
  background: var(--cp-leaf-dark);
  color: white;
  padding: 8px 10px;
  font-size: 12px;
  font-weight: 900;
  white-space: nowrap;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.chiayi-pikmin-mini-btn img {
  width: 18px;
  height: 18px;
  object-fit: contain;
  margin: -3px 0;
}

.chiayi-pikmin-time-tool {
  position: relative;
  z-index: 1;
  display: grid;
  grid-template-columns: minmax(0, 1fr) 88px 56px;
  gap: 5px;
  align-items: center;
  margin-top: 6px;
}

.chiayi-pikmin-time-tool label {
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 4px;
  min-height: 30px;
  padding: 4px 7px;
  border-radius: 12px;
  background: rgba(255,255,255,0.72);
  color: var(--cp-muted);
  font-size: 12px;
  font-weight: 900;
}

.chiayi-pikmin-time-tool input {
  min-width: 0;
  width: 100%;
  border: 0;
  background: transparent;
  color: var(--cp-text);
  font: inherit;
  font-size: 12px;
  height: 20px;
  outline: none;
}

.chiayi-pikmin-time-tool input[type="number"] {
  text-align: right;
}

.chiayi-pikmin-time-tool button {
  min-height: 30px;
  border: 0;
  border-radius: 12px;
  background: #ffffff;
  color: var(--cp-leaf-dark);
  font-size: 12px;
  font-weight: 900;
  cursor: pointer;
}

.chiayi-pikmin-quick-read {
  position: relative;
  z-index: 1;
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
  margin-top: 5px;
  color: var(--cp-muted);
  font-size: 12px;
  font-weight: 800;
}

.chiayi-pikmin-quick-read b {
  color: var(--cp-text);
  font-size: 12px;
}

.chiayi-pikmin-train-line {
  position: relative;
  z-index: 1;
  display: grid;
  grid-template-columns: 1fr;
  gap: 2px;
  margin-top: 5px;
  color: var(--cp-muted);
  font-size: 11px;
  font-weight: 800;
}

.chiayi-pikmin-train-line span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.chiayi-pikmin-party {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 8px;
  position: relative;
  z-index: 1;
}

.chiayi-pikmin-seed {
  width: 22px;
  height: 22px;
  border-radius: 50% 50% 45% 45%;
  display: grid;
  place-items: center;
  color: #fff;
  font-size: 12px;
  font-weight: 900;
  box-shadow: inset 0 -4px 0 rgba(0,0,0,0.08);
  opacity: 0.32;
  transform: translateY(3px);
  transition: 0.25s ease;
}

.chiayi-pikmin-seed.found {
  opacity: 1;
  transform: translateY(0);
}

.chiayi-pikmin-seed.red { background: var(--cp-red); }
.chiayi-pikmin-seed.blue { background: var(--cp-blue); }
.chiayi-pikmin-seed.yellow { background: var(--cp-sun); color: #5b4b12; }
.chiayi-pikmin-seed.purple { background: var(--cp-purple); }

.chiayi-pikmin-section-title {
  margin: 14px 4px 8px;
  font-size: 13px;
  color: var(--cp-muted);
  font-weight: 900;
  letter-spacing: 0.05em;
}

.chiayi-pikmin-timeline {
  position: relative;
  padding-left: 14px;
}

.chiayi-pikmin-timeline::before {
  content: "";
  position: absolute;
  top: 8px;
  bottom: 14px;
  left: 5px;
  width: 2px;
  background: linear-gradient(180deg, var(--cp-leaf), var(--cp-sun-soft), var(--cp-line));
  border-radius: 99px;
}

.chiayi-pikmin-stop {
  position: relative;
  margin-bottom: 8px;
  transition: opacity 0.25s ease, transform 0.25s ease;
}

.chiayi-pikmin-stop::before {
  content: "";
  position: absolute;
  left: -14px;
  top: 18px;
  width: 11px;
  height: 11px;
  border-radius: 50%;
  background: var(--cp-card);
  border: 2px solid var(--cp-leaf);
  z-index: 2;
}

.chiayi-pikmin-stop.support::before {
  border-color: var(--cp-line);
}

.chiayi-pikmin-stop.done {
  opacity: 0.66;
}

.chiayi-pikmin-stop.done::before {
  background: var(--cp-leaf);
}

.chiayi-pikmin-stop.current .chiayi-pikmin-card {
  outline: 2px solid rgba(127, 208, 202, 0.46);
}

.chiayi-pikmin-stop.dragging .chiayi-pikmin-card {
  opacity: 0.68;
  transform: scale(0.985);
}

.chiayi-pikmin-stop.drag-over .chiayi-pikmin-card {
  outline: 2px dashed rgba(10, 111, 105, 0.62);
  outline-offset: 3px;
}

.chiayi-pikmin-card {
  background: var(--cp-card);
  border: 1px solid rgba(204, 232, 222, 0.95);
  border-radius: 18px;
  box-shadow: 0 6px 16px rgba(55, 113, 111, 0.07);
  overflow: hidden;
}

.chiayi-pikmin-card-main {
  padding: 11px 12px 10px;
}

.chiayi-pikmin-meta {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
  margin-bottom: 6px;
}

.chiayi-pikmin-time {
  color: var(--cp-leaf-dark);
  font-weight: 900;
  font-size: 13px;
}

.chiayi-pikmin-tag {
  font-size: 11px;
  padding: 3px 7px;
  border-radius: 999px;
  background: #f4edc9;
  color: var(--cp-muted);
  font-weight: 700;
}

.chiayi-pikmin-tag.current-tag,
.chiayi-pikmin-tag.stay,
.chiayi-pikmin-tag.zone {
  background: var(--cp-leaf-soft);
  color: var(--cp-leaf-dark);
  font-weight: 900;
}

.chiayi-pikmin-tag.zone {
  background: rgba(255, 243, 189, 0.8);
  color: #80671d;
}

.chiayi-pikmin-title-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.chiayi-pikmin-drag-handle {
  width: 28px;
  height: 32px;
  flex: 0 0 28px;
  display: inline-grid;
  place-content: center;
  gap: 3px;
  border: 1px solid rgba(204, 232, 222, 0.95);
  border-radius: 12px;
  background: rgba(235, 251, 248, 0.9);
  cursor: grab;
  touch-action: none;
}

.chiayi-pikmin-drag-handle:active {
  cursor: grabbing;
}

.chiayi-pikmin-drag-handle:disabled {
  opacity: 0.34;
  cursor: not-allowed;
}

.chiayi-pikmin-drag-handle span {
  width: 12px;
  height: 2px;
  border-radius: 99px;
  background: var(--cp-leaf-dark);
}

.chiayi-pikmin-stop-title {
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 7px;
}

.chiayi-pikmin-stop-title img {
  width: 26px;
  height: 26px;
  flex: 0 0 26px;
  object-fit: contain;
  filter: drop-shadow(0 2px 2px rgba(47, 64, 63, 0.12));
}

.chiayi-pikmin-title-row h2 {
  margin: 0;
  font-size: 16px;
  line-height: 1.35;
  min-width: 0;
}

.chiayi-pikmin-check {
  width: 32px;
  height: 32px;
  flex: 0 0 32px;
  border-radius: 14px;
  border: 1px solid var(--cp-line);
  background: #fff;
  color: var(--cp-leaf-dark);
  font-weight: 900;
  cursor: pointer;
}

.chiayi-pikmin-stop.done .chiayi-pikmin-check {
  background: var(--cp-leaf);
  color: white;
  border-color: var(--cp-leaf);
}

.chiayi-pikmin-desc {
  margin: 7px 0 0;
  color: var(--cp-muted);
  font-size: 13px;
  line-height: 1.45;
}

.chiayi-pikmin-reward {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin-top: 9px;
  padding: 6px 9px;
  border-radius: 999px;
  background: var(--cp-sun-soft);
  color: #6e5b15;
  font-size: 12px;
  font-weight: 900;
}

.chiayi-pikmin-card details {
  border-top: 1px solid #eee6c6;
  padding: 0 12px 12px;
}

.chiayi-pikmin-card summary {
  list-style: none;
  cursor: pointer;
  color: var(--cp-leaf-dark);
  font-weight: 900;
  font-size: 13px;
  padding: 9px 0;
}

.chiayi-pikmin-card summary::-webkit-details-marker {
  display: none;
}

.chiayi-pikmin-detail-grid {
  display: grid;
  gap: 8px;
  font-size: 13px;
  line-height: 1.48;
  color: var(--cp-muted);
}

.chiayi-pikmin-detail-grid b {
  color: var(--cp-text);
  display: block;
  margin-bottom: 2px;
}

.chiayi-pikmin-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 8px;
}

.chiayi-pikmin-chip {
  text-decoration: none;
  color: var(--cp-leaf-dark);
  background: var(--cp-leaf-soft);
  padding: 7px 10px;
  border-radius: 999px;
  font-size: 13px;
  font-weight: 900;
}

.chiayi-pikmin-actions {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
  padding: 2px 0 0;
}

.chiayi-pikmin-reorder {
  display: grid;
  grid-template-columns: 1fr auto auto;
  gap: 8px;
  align-items: center;
  padding: 8px;
  border-radius: 14px;
  background: rgba(255, 243, 189, 0.46);
}

.chiayi-pikmin-reorder span {
  min-width: 0;
  color: var(--cp-muted);
  font-size: 12px;
  font-weight: 800;
}

.chiayi-pikmin-reorder button {
  border: 1px solid rgba(204, 232, 222, 0.95);
  border-radius: 12px;
  background: #fff;
  color: var(--cp-leaf-dark);
  padding: 8px 9px;
  font-size: 12px;
  font-weight: 900;
  cursor: pointer;
}

.chiayi-pikmin-reorder button:disabled {
  opacity: 0.38;
  cursor: not-allowed;
}

.chiayi-pikmin-action {
  display: inline-flex;
  justify-content: center;
  align-items: center;
  gap: 5px;
  text-decoration: none;
  border-radius: 14px;
  padding: 10px 8px;
  font-size: 13px;
  font-weight: 900;
  border: 1px solid var(--cp-line);
  color: var(--cp-text);
  background: #fff;
  cursor: pointer;
}

.chiayi-pikmin-action img {
  width: 20px;
  height: 20px;
  object-fit: contain;
  margin: -4px 0;
}

.chiayi-pikmin-action.primary {
  background: var(--cp-leaf-dark);
  color: white;
  border-color: var(--cp-leaf-dark);
}

.chiayi-pikmin-note-card {
  background: rgba(255, 254, 246, 0.76);
  border: 1px solid rgba(204, 232, 222, 0.95);
  border-radius: var(--cp-radius);
  padding: 16px;
  color: var(--cp-muted);
  font-size: 14px;
  line-height: 1.65;
  box-shadow: 0 8px 18px rgba(55, 113, 111, 0.07);
}

.chiayi-pikmin-note-card p {
  margin: 0 0 0.85rem;
}

.chiayi-pikmin-note-card p:last-child {
  margin-bottom: 0;
}

.chiayi-pikmin-note-card b {
  color: var(--cp-text);
}

.chiayi-pikmin-bottom-nav {
  position: fixed;
  left: 50%;
  bottom: 14px;
  transform: translateX(-50%);
  width: min(398px, calc(100% - 28px));
  background: rgba(47, 64, 63, 0.88);
  backdrop-filter: blur(14px);
  border-radius: 24px;
  padding: 10px;
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
  box-shadow: 0 16px 40px rgba(47, 64, 63, 0.22);
  z-index: 30;
}

.chiayi-pikmin-bottom-nav button,
.chiayi-pikmin-bottom-nav a {
  border: 0;
  border-radius: 16px;
  padding: 12px 10px;
  font-weight: 900;
  text-align: center;
  text-decoration: none;
  cursor: pointer;
}

.chiayi-pikmin-bottom-nav .light {
  background: rgba(255,255,255,0.94);
  color: var(--cp-text);
}

.chiayi-pikmin-bottom-nav .dark {
  background: var(--cp-sun);
  color: #4f4411;
}

@media (min-width: 720px) {
  .chiayi-pikmin-app {
    padding-top: 24px;
  }
}
`;
