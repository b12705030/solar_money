// Wizard Steps 1–4

const { useState: useStateW, useEffect: useEffectW, useMemo: useMemoW } = React;

/* ========== Step 1: Address ========== */
function StepAddress({ state, update }) {
  const [query, setQuery] = useStateW(state.addressQuery || "");
  const [selected, setSelected] = useStateW(state.address || null);
  const suggestions = [
    { label: "台北市信義區松仁路 100 號", meta: "住宅大樓 · 地上12層", area: 78, type: "公寓大廈", floors: 12, region: "北部" },
    { label: "新北市板橋區文化路一段 50 號", meta: "透天厝 · 地上4層", area: 42, type: "透天厝", floors: 4, region: "北部" },
    { label: "台中市西屯區市政路 200 號", meta: "住宅大樓 · 地上15層", area: 92, type: "公寓大廈", floors: 15, region: "中部" },
    { label: "高雄市前鎮區中山二路 80 號", meta: "透天厝 · 地上3層", area: 38, type: "透天厝", floors: 3, region: "南部" },
  ];
  const filtered = query
    ? suggestions.filter(s => s.label.includes(query) || query.length < 2)
    : suggestions;

  const pick = (s) => {
    setSelected(s);
    setQuery(s.label);
    update({ address: s, addressQuery: s.label, roofArea: s.area });
  };

  const a = state.address;
  const roofArea = state.roofArea ?? (a?.area || 0);

  return (
    <div data-screen-label="01 Address">
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1.15fr", gap: 44, alignItems: "start" }}>
        <div>
          <div className="eyebrow" style={{ marginBottom: 16 }}>Step 1 · 地址</div>
          <h2 className="h-title" style={{ margin: "0 0 14px" }}>你家在哪裡？</h2>
          <p className="body" style={{ marginBottom: 28, color: "var(--ink-500)" }}>
            輸入地址後，系統會從建物資料庫帶入屋頂面積、樓層等資訊。你可以手動調整。
          </p>

          {/* Search */}
          <div style={{ position: "relative" }}>
            <div style={{
              display: "flex", alignItems: "center", gap: 10,
              padding: "14px 18px",
              background: "var(--white)",
              border: "1px solid var(--ink-200)",
              borderRadius: "var(--radius-md)",
              boxShadow: "var(--shadow-sm)",
              transition: "border-color 0.2s, box-shadow 0.2s",
            }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--ink-400)" strokeWidth="2" strokeLinecap="round">
                <circle cx="11" cy="11" r="7" />
                <path d="M20 20 L16 16" />
              </svg>
              <input
                value={query}
                onChange={e => { setQuery(e.target.value); setSelected(null); }}
                placeholder="輸入地址或地段（例：台北市信義區松仁路）"
                style={{
                  flex: 1, border: "none", outline: "none", background: "transparent",
                  fontSize: 15, color: "var(--ink-900)",
                }}
              />
            </div>

            {/* Suggestions dropdown */}
            {query && !selected && (
              <div style={{
                position: "absolute", top: "100%", left: 0, right: 0, marginTop: 6,
                background: "var(--white)",
                border: "1px solid var(--ink-200)",
                borderRadius: "var(--radius-md)",
                boxShadow: "var(--shadow-lg)",
                overflow: "hidden", zIndex: 20,
              }}>
                {filtered.map((s, i) => (
                  <button key={i} onClick={() => pick(s)} style={{
                    display: "flex", width: "100%", alignItems: "center", justifyContent: "space-between",
                    padding: "12px 16px", textAlign: "left",
                    borderBottom: i < filtered.length - 1 ? "1px solid var(--ink-100)" : "none",
                    transition: "background 0.15s",
                  }}
                  onMouseEnter={e => e.currentTarget.style.background = "var(--green-50)"}
                  onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                    <div>
                      <div style={{ fontSize: 14, fontWeight: 500, color: "var(--ink-900)" }}>{s.label}</div>
                      <div style={{ fontSize: 12, color: "var(--ink-500)", marginTop: 2 }}>{s.meta}</div>
                    </div>
                    <ChevronIcon dir="right" />
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Detected info */}
          {a && (
            <div style={{ marginTop: 28 }}>
              <div className="body-sm" style={{ marginBottom: 12, display: "flex", alignItems: "center", gap: 6 }}>
                <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--green-500)" }} />
                系統自動帶入（可調整）
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 20 }}>
                <div className="card" style={{ padding: 16 }}>
                  <div className="caption">建物類型</div>
                  <div style={{ fontSize: 16, fontWeight: 500, marginTop: 4 }}>{a.type}</div>
                </div>
                <div className="card" style={{ padding: 16 }}>
                  <div className="caption">樓層數</div>
                  <div className="num" style={{ fontSize: 16, fontWeight: 500, marginTop: 4 }}>{a.floors} 層</div>
                </div>
              </div>

              {/* Roof area slider */}
              <div className="card" style={{ padding: 20 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 12 }}>
                  <div>
                    <div className="caption">可用屋頂面積<Info tip="扣除水塔、梯間後約可鋪設面積" /></div>
                  </div>
                  <div>
                    <span className="num" style={{ fontSize: 28, fontWeight: 700, color: "var(--green-700)" }}>{roofArea}</span>
                    <span style={{ fontSize: 13, color: "var(--ink-500)", marginLeft: 4 }}>坪</span>
                  </div>
                </div>
                <input
                  type="range" min="10" max="200" value={roofArea}
                  onChange={e => update({ roofArea: +e.target.value })}
                  style={{ width: "100%", accentColor: "var(--green-700)" }}
                />
                <div style={{ display: "flex", justifyContent: "space-between", marginTop: 6 }}>
                  <span className="caption">10 坪</span>
                  <span className="caption">200 坪</span>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Map preview */}
        <div style={{
          position: "sticky", top: 100,
          aspectRatio: "1 / 1",
          borderRadius: "var(--radius-lg)",
          overflow: "hidden",
          border: "1px solid var(--ink-100)",
          background: "var(--paper-2)",
        }}>
          <MapPreview address={a} />
        </div>
      </div>
    </div>
  );
}

function MapPreview({ address }) {
  // Stylized map — not a real tile, a placeholder showing building highlight
  const highlighted = !!address;
  return (
    <div style={{ position: "relative", width: "100%", height: "100%",
      background:
        "linear-gradient(135deg, #E8EEE7 0%, #DCE5DA 100%)"
    }}>
      {/* Street grid */}
      <svg viewBox="0 0 400 400" style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}>
        {/* Roads */}
        <path d="M -20 120 Q 100 110 220 140 T 420 180" stroke="#FFFFFF" strokeWidth="14" fill="none" opacity="0.9" />
        <path d="M 80 -20 Q 90 150 120 280 T 160 420" stroke="#FFFFFF" strokeWidth="10" fill="none" opacity="0.9" />
        <path d="M 260 -20 Q 280 200 300 420" stroke="#FFFFFF" strokeWidth="10" fill="none" opacity="0.9" />
        <path d="M -20 320 Q 200 310 420 340" stroke="#FFFFFF" strokeWidth="8" fill="none" opacity="0.9" />

        {/* Road dashes */}
        <path d="M -20 120 Q 100 110 220 140 T 420 180" stroke="#DDE8DB" strokeWidth="2" strokeDasharray="8 8" fill="none" />

        {/* Building blocks (context) */}
        {[
          [40, 40, 30, 50], [140, 40, 60, 45], [220, 50, 30, 40], [320, 40, 50, 50],
          [40, 180, 40, 60], [170, 200, 40, 60], [330, 220, 40, 50],
          [40, 340, 50, 40], [190, 350, 40, 40], [340, 360, 50, 40],
        ].map(([x, y, w, h], i) => (
          <rect key={i} x={x} y={y} width={w} height={h}
            fill="#FFFFFF" stroke="#C9D4C7" strokeWidth="1" rx="2" opacity="0.85" />
        ))}

        {/* Greenery */}
        <circle cx="60" cy="260" r="18" fill="#B7E4C7" opacity="0.6" />
        <circle cx="110" cy="280" r="12" fill="#B7E4C7" opacity="0.6" />
        <circle cx="370" cy="140" r="16" fill="#B7E4C7" opacity="0.6" />

        {/* The target building */}
        {highlighted && (
          <g style={{ transformOrigin: "200px 200px", animation: "pulse-building 2s ease-out" }}>
            <rect x="170" y="165" width="70" height="75" fill="#2D6A4F" stroke="#1B4332" strokeWidth="2" rx="3" />
            {/* Roof panel pattern */}
            {[0,1,2].map(r => [0,1,2].map(c => (
              <rect key={`${r}-${c}`} x={177 + c*19} y={172 + r*22} width="15" height="18"
                fill="#40916C" stroke="#1B4332" strokeWidth="0.6" />
            )))}
            {/* Highlight ring */}
            <circle cx="205" cy="202" r="60" fill="none" stroke="#2D6A4F" strokeWidth="2" strokeDasharray="4 6" opacity="0.5" />
            <circle cx="205" cy="202" r="80" fill="none" stroke="#2D6A4F" strokeWidth="1" strokeDasharray="2 4" opacity="0.3" />
          </g>
        )}
      </svg>

      {!highlighted && (
        <div style={{
          position: "absolute", inset: 0, display: "grid", placeItems: "center",
          color: "var(--ink-400)", fontSize: 13,
        }}>
          輸入地址以顯示建物位置
        </div>
      )}

      {/* Map chips */}
      {highlighted && (
        <>
          <div style={{
            position: "absolute", top: 16, left: 16,
            padding: "8px 14px", background: "rgba(255,255,255,0.95)",
            backdropFilter: "blur(4px)",
            borderRadius: 999, fontSize: 12, color: "var(--ink-700)",
            display: "flex", alignItems: "center", gap: 8,
            boxShadow: "var(--shadow-sm)",
          }}>
            <SunIcon size={14} color="#E8A53C" /> 年均日照 1,580 kWh/m²
          </div>
          <div style={{
            position: "absolute", bottom: 16, right: 16,
            padding: "8px 14px", background: "var(--green-700)", color: "var(--white)",
            borderRadius: 999, fontSize: 12,
            display: "flex", alignItems: "center", gap: 8,
            boxShadow: "var(--shadow-md)",
            fontWeight: 500,
          }}>
            <div style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--amber)" }} />
            已定位建物
          </div>

          {/* Compass */}
          <div style={{
            position: "absolute", top: 16, right: 16,
            width: 44, height: 44, borderRadius: "50%",
            background: "rgba(255,255,255,0.95)",
            display: "grid", placeItems: "center",
            boxShadow: "var(--shadow-sm)",
            fontSize: 11, color: "var(--ink-500)", fontWeight: 600,
          }}>
            <div style={{ position: "absolute", top: 4, color: "var(--danger)" }}>N</div>
            <div style={{ width: 2, height: 22, background: "linear-gradient(var(--danger) 50%, var(--ink-400) 50%)" }} />
          </div>
        </>
      )}

      <style>{`@keyframes pulse-building {
        0% { transform: scale(0.8); opacity: 0; }
        100% { transform: scale(1); opacity: 1; }
      }`}</style>
    </div>
  );
}

/* ========== Step 2: Usage ========== */
function StepUsage({ state, update }) {
  const kwh = state.monthlyKwh ?? 350;
  return (
    <div data-screen-label="02 Usage">
      <div style={{ maxWidth: 720 }}>
        <div className="eyebrow" style={{ marginBottom: 16 }}>Step 2 · 用電狀況</div>
        <h2 className="h-title" style={{ margin: "0 0 14px" }}>你家每個月用多少電？</h2>
        <p className="body" style={{ marginBottom: 40, color: "var(--ink-500)" }}>
          不確定？可以看台電帳單的「本期用電度數」，或直接用台灣家庭平均值繼續。
        </p>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1.1fr 1fr", gap: 40 }}>
        {/* Input card */}
        <div className="card elevated" style={{ padding: 36 }}>
          <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 24 }}>
            <div className="body-sm">月均用電度數</div>
            {kwh === 350 && <Badge tone="ink">預設值</Badge>}
          </div>

          <div style={{ display: "flex", alignItems: "baseline", gap: 12, marginBottom: 30 }}>
            <input
              type="number" min="50" max="2000" value={kwh}
              onChange={e => update({ monthlyKwh: Math.max(50, Math.min(2000, +e.target.value || 0)) })}
              className="num"
              style={{
                fontSize: 72, fontWeight: 700, color: "var(--green-700)",
                border: "none", outline: "none", background: "transparent",
                width: 180, padding: 0,
              }}
            />
            <span style={{ fontSize: 22, color: "var(--ink-500)", fontWeight: 500 }}>度 / 月</span>
          </div>

          {/* Slider */}
          <div>
            <input
              type="range" min="100" max="1200" value={kwh}
              onChange={e => update({ monthlyKwh: +e.target.value })}
              style={{ width: "100%", accentColor: "var(--green-700)" }}
            />
            <div style={{ display: "flex", justifyContent: "space-between", marginTop: 8 }}>
              <div style={{ textAlign: "left" }}>
                <div className="num" style={{ fontSize: 13, fontWeight: 600 }}>100</div>
                <div className="caption">小家庭</div>
              </div>
              <div style={{ textAlign: "center", opacity: kwh >= 300 && kwh <= 400 ? 1 : 0.4 }}>
                <div className="num" style={{ fontSize: 13, fontWeight: 600, color: "var(--green-700)" }}>350</div>
                <div className="caption">平均</div>
              </div>
              <div style={{ textAlign: "center" }}>
                <div className="num" style={{ fontSize: 13, fontWeight: 600 }}>700</div>
                <div className="caption">多人家庭</div>
              </div>
              <div style={{ textAlign: "right" }}>
                <div className="num" style={{ fontSize: 13, fontWeight: 600 }}>1,200+</div>
                <div className="caption">大用電戶</div>
              </div>
            </div>
          </div>
        </div>

        {/* Context card */}
        <div className="card" style={{ padding: 28, background: "var(--green-50)", borderColor: "var(--green-200)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16 }}>
            <SunIcon size={18} color="var(--green-700)" />
            <div style={{ fontSize: 13, fontWeight: 600, color: "var(--green-700)" }}>依此估算</div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
            <div>
              <div className="caption">目前電費級距</div>
              <div style={{ fontSize: 18, fontWeight: 600, marginTop: 4 }}>
                {kwh <= 330 ? "非夏月 1.63 元/度" : kwh <= 500 ? "第二級 2.10 元/度" : "第三級 2.89 元/度"}
              </div>
            </div>
            <div>
              <div className="caption">年用電量估計</div>
              <div>
                <span className="num" style={{ fontSize: 28, fontWeight: 700, color: "var(--green-700)" }}>
                  {(kwh * 12).toLocaleString()}
                </span>
                <span style={{ fontSize: 14, color: "var(--ink-500)", marginLeft: 6 }}>kWh / 年</span>
              </div>
            </div>
            <div>
              <div className="caption">年電費支出</div>
              <div>
                <span className="num" style={{ fontSize: 28, fontWeight: 700 }}>
                  NT$ {Math.round(kwh * 12 * (kwh <= 330 ? 1.63 : kwh <= 500 ? 2.1 : 2.89)).toLocaleString()}
                </span>
              </div>
            </div>
          </div>

          <div style={{ marginTop: 20, paddingTop: 16, borderTop: "1px solid var(--green-200)" }}>
            <div className="body-sm" style={{ color: "var(--ink-500)" }}>
              ⓘ 級距依 2025 年台電民生用電表估算，實際帳單可能因夏/非夏月、時段而異。
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ========== Step 3: Optimization Goal ========== */
const GOALS = [
  { id: "annual",   title: "全年總發電量最高", desc: "讓板子一整年盡量多發電",           icon: "annual" },
  { id: "summer",   title: "夏季發電量最高",   desc: "夏天冷氣用電多，讓太陽能補上這塊",   icon: "summer" },
  { id: "winter",   title: "冬季發電量最高",   desc: "適合冬天用電需求高的家庭",         icon: "winter" },
  { id: "peak",     title: "正午峰值最高",     desc: "讓每天最強的那段陽光被充分利用",    icon: "peak" },
  { id: "match",    title: "與用電曲線最匹配", desc: "讓發電時間對齊你的用電時間，減少浪費", icon: "match" },
  { id: "roi",      title: "投資回收最快",     desc: "最快看到錢回來",                  icon: "roi" },
];

function GoalIcon({ kind, color }) {
  const c = color || "var(--green-700)";
  switch (kind) {
    case "annual":
      return <svg width="28" height="28" viewBox="0 0 28 28" fill="none" stroke={c} strokeWidth="1.6"><circle cx="14" cy="14" r="5" fill={c} stroke="none"/>{[...Array(12)].map((_,i)=>{const a=i*30*Math.PI/180;return <line key={i} x1={14+Math.cos(a)*8} y1={14+Math.sin(a)*8} x2={14+Math.cos(a)*11} y2={14+Math.sin(a)*11} strokeLinecap="round"/>})}</svg>;
    case "summer":
      return <svg width="28" height="28" viewBox="0 0 28 28" fill="none" stroke={c} strokeWidth="1.6"><circle cx="14" cy="10" r="4" fill={c} stroke="none"/><path d="M5 22 Q 14 15 23 22" strokeLinecap="round"/><line x1="14" y1="3" x2="14" y2="5" strokeLinecap="round"/><line x1="22" y1="6" x2="20" y2="7.5" strokeLinecap="round"/><line x1="6" y1="6" x2="8" y2="7.5" strokeLinecap="round"/></svg>;
    case "winter":
      return <svg width="28" height="28" viewBox="0 0 28 28" fill="none" stroke={c} strokeWidth="1.6" strokeLinecap="round"><line x1="14" y1="4" x2="14" y2="24"/><line x1="6" y1="9" x2="22" y2="19"/><line x1="6" y1="19" x2="22" y2="9"/><path d="M11 6 L14 9 L17 6"/><path d="M17 22 L14 19 L11 22"/></svg>;
    case "peak":
      return <svg width="28" height="28" viewBox="0 0 28 28" fill="none" stroke={c} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M4 22 Q 14 4 24 22" fill={c+"22"} stroke={c}/><line x1="14" y1="4" x2="14" y2="22" strokeDasharray="2 3"/></svg>;
    case "match":
      return <svg width="28" height="28" viewBox="0 0 28 28" fill="none" stroke={c} strokeWidth="1.6" strokeLinecap="round"><path d="M3 18 Q 8 10 13 18 T 25 14"/><path d="M3 16 Q 8 8 13 16 T 25 12" strokeDasharray="3 3" opacity="0.6"/></svg>;
    case "roi":
      return <svg width="28" height="28" viewBox="0 0 28 28" fill="none" stroke={c} strokeWidth="1.6" strokeLinecap="round"><path d="M4 22 L12 14 L16 18 L24 8"/><path d="M18 8 L24 8 L24 14"/></svg>;
    default: return null;
  }
}

function StepGoal({ state, update }) {
  const region = state.address?.region || "北部";
  const recommended = useMemoW(() => {
    if (region === "北部") return "summer";
    if (region === "南部") return "annual";
    return "match";
  }, [region]);

  // Auto-select on first visit
  useEffectW(() => {
    if (!state.goal) update({ goal: recommended });
  }, []);

  const goal = state.goal || recommended;

  return (
    <div data-screen-label="03 Goal">
      <div style={{ maxWidth: 720, marginBottom: 36 }}>
        <div className="eyebrow" style={{ marginBottom: 16 }}>Step 3 · 優化目標</div>
        <h2 className="h-title" style={{ margin: "0 0 14px" }}>你最想達成什麼目標？</h2>
        <p className="body" style={{ color: "var(--ink-500)" }}>
          不同目標會影響板子的安裝角度與朝向。我們根據你的地區（<b style={{ color: "var(--green-700)" }}>{region}</b>）推薦了「{GOALS.find(g => g.id === recommended)?.title}」。
        </p>
      </div>

      <div style={{
        display: "grid",
        gridTemplateColumns: "repeat(3, 1fr)",
        gap: 14,
      }}>
        {GOALS.map((g) => {
          const active = goal === g.id;
          const isRec = recommended === g.id;
          return (
            <button
              key={g.id}
              onClick={() => update({ goal: g.id })}
              style={{
                position: "relative", textAlign: "left",
                padding: 22,
                background: active ? "var(--green-700)" : "var(--white)",
                color: active ? "var(--white)" : "var(--ink-900)",
                border: `1.5px solid ${active ? "var(--green-700)" : "var(--ink-200)"}`,
                borderRadius: "var(--radius-lg)",
                transition: "all 0.25s var(--ease-out)",
                boxShadow: active ? "var(--shadow-md)" : "var(--shadow-sm)",
                cursor: "pointer",
                display: "flex", flexDirection: "column", gap: 12,
                minHeight: 160,
              }}
              onMouseEnter={e => { if (!active) { e.currentTarget.style.borderColor = "var(--green-500)"; e.currentTarget.style.transform = "translateY(-2px)"; }}}
              onMouseLeave={e => { if (!active) { e.currentTarget.style.borderColor = "var(--ink-200)"; e.currentTarget.style.transform = "translateY(0)"; }}}
            >
              {isRec && (
                <div style={{ position: "absolute", top: 12, right: 12 }}>
                  <span style={{
                    display: "inline-flex", alignItems: "center", gap: 4,
                    padding: "3px 10px", borderRadius: 999,
                    background: active ? "rgba(255,255,255,0.18)" : "var(--amber-soft)",
                    color: active ? "var(--white)" : "#8B5A10",
                    fontSize: 10, fontWeight: 600, letterSpacing: "0.04em",
                  }}>★ 推薦</span>
                </div>
              )}
              <div style={{
                width: 44, height: 44, borderRadius: 12,
                background: active ? "rgba(255,255,255,0.15)" : "var(--green-50)",
                display: "grid", placeItems: "center",
              }}>
                <GoalIcon kind={g.icon} color={active ? "var(--white)" : "var(--green-700)"} />
              </div>
              <div>
                <div style={{ fontSize: 17, fontWeight: 600, marginBottom: 4 }}>{g.title}</div>
                <div style={{ fontSize: 13, color: active ? "rgba(255,255,255,0.8)" : "var(--ink-500)", lineHeight: 1.45 }}>{g.desc}</div>
              </div>
              {active && (
                <div style={{ position: "absolute", top: 12, left: 12,
                  width: 22, height: 22, borderRadius: "50%",
                  background: "var(--white)", color: "var(--green-700)",
                  display: "grid", placeItems: "center",
                }}>
                  <CheckIcon size={12} />
                </div>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* ========== Step 4: Parameters ========== */
// Subsidies by region (approximate, illustrative)
const SUBSIDIES = {
  "台北市": { amount: 15000, per: "kW", source: "台北市政府產發局" },
  "新北市": { amount: 12000, per: "kW", source: "新北市綠能推動計畫" },
  "台中市": { amount: 10000, per: "kW", source: "台中市環保局" },
  "高雄市": { amount: 18000, per: "kW", source: "高雄市經發局" },
};

function guessCounty(label) {
  if (!label) return "台北市";
  if (label.includes("台北")) return "台北市";
  if (label.includes("新北")) return "新北市";
  if (label.includes("台中")) return "台中市";
  if (label.includes("高雄")) return "高雄市";
  return "台北市";
}

function StepParams({ state, update }) {
  const area = state.roofArea || 78; // 坪
  // ~0.165 kW per m², 1 坪 ≈ 3.3 m²; usable ratio 0.6
  const capacity = +(area * 3.3 * 0.6 * 0.165).toFixed(1);
  const costPerKw = state.costPerKw ?? 55000;
  const totalCost = Math.round(capacity * costPerKw);
  const county = guessCounty(state.address?.label);
  const subsidy = SUBSIDIES[county];
  const subsidyAmount = subsidy.amount * capacity;
  const outOfPocket = totalCost - subsidyAmount;

  useEffectW(() => {
    update({ capacity, totalCost, subsidyAmount, outOfPocket, county });
  }, [capacity, costPerKw, county]);

  return (
    <div data-screen-label="04 Params">
      <div style={{ maxWidth: 720, marginBottom: 36 }}>
        <div className="eyebrow" style={{ marginBottom: 16 }}>Step 4 · 基本參數</div>
        <h2 className="h-title" style={{ margin: "0 0 14px" }}>確認安裝參數</h2>
        <p className="body" style={{ color: "var(--ink-500)" }}>
          系統根據你的屋頂面積估算可裝容量，並帶入 <b style={{ color: "var(--green-700)" }}>{county}</b> 的政府補助金額。你可以調整安裝單價。
        </p>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1.2fr 1fr", gap: 24 }}>
        {/* Capacity and cost */}
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {/* Capacity */}
          <div className="card" style={{ padding: 26, background: "var(--green-900)", color: "var(--white)", borderColor: "transparent", position: "relative", overflow: "hidden" }}>
            <div style={{
              position: "absolute", top: -40, right: -40, width: 180, height: 180, borderRadius: "50%",
              background: "radial-gradient(circle, rgba(232,165,60,0.25), transparent 70%)",
            }} />
            <div style={{ fontSize: 12, opacity: 0.7, letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 8 }}>預估安裝容量</div>
            <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
              <span className="num" style={{ fontSize: 64, fontWeight: 700, lineHeight: 1 }}>{capacity}</span>
              <span style={{ fontSize: 20, opacity: 0.8 }}>kW</span>
              <Info tip="根據屋頂面積、可用比例與板效率估算" />
            </div>
            <div style={{ marginTop: 14, display: "flex", gap: 20, fontSize: 13, opacity: 0.8, position: "relative" }}>
              <div>約需板子 <b className="num" style={{ color: "var(--amber)" }}>{Math.round(capacity / 0.45)}</b> 片</div>
              <div>占用屋頂 <b className="num" style={{ color: "var(--amber)" }}>{area}</b> 坪</div>
            </div>
          </div>

          {/* Install cost slider */}
          <div className="card" style={{ padding: 24 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 12 }}>
              <div>
                <div className="caption">安裝單價<Info tip="台灣市場 2025 年均價約 NT$ 50,000 – 60,000 / kW" /></div>
              </div>
              <div>
                <span className="num" style={{ fontSize: 24, fontWeight: 700, color: "var(--green-700)" }}>NT$ {costPerKw.toLocaleString()}</span>
                <span style={{ fontSize: 12, color: "var(--ink-500)", marginLeft: 4 }}>/ kW</span>
              </div>
            </div>
            <input
              type="range" min="40000" max="75000" step="1000" value={costPerKw}
              onChange={e => update({ costPerKw: +e.target.value })}
              style={{ width: "100%", accentColor: "var(--green-700)" }}
            />
            <div style={{ display: "flex", justifyContent: "space-between", marginTop: 6 }}>
              <span className="caption">40,000（競爭價）</span>
              <span className="caption">75,000（高規）</span>
            </div>
            <div style={{ marginTop: 18, paddingTop: 14, borderTop: "1px solid var(--ink-100)", display: "flex", justifyContent: "space-between" }}>
              <span className="body-sm">總安裝費用</span>
              <span className="num" style={{ fontSize: 20, fontWeight: 700 }}>NT$ {totalCost.toLocaleString()}</span>
            </div>
          </div>
        </div>

        {/* Subsidy breakdown */}
        <div className="card" style={{ padding: 26 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 18 }}>
            <div style={{ width: 28, height: 28, borderRadius: 8, background: "var(--amber-soft)", display: "grid", placeItems: "center" }}>
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="#8B5A10" strokeWidth="1.6"><path d="M8 2 L8 14 M4 5 Q 4 3 6 3 L10 3 Q 12 3 12 5 Q 12 7 10 7 L6 7 Q 4 7 4 9 Q 4 11 6 11 L10 11 Q 12 11 12 13" strokeLinecap="round"/></svg>
            </div>
            <div>
              <div style={{ fontSize: 13, fontWeight: 600, color: "var(--ink-900)" }}>政府補助快查</div>
              <div className="caption">{county} · {subsidy.source}</div>
            </div>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 20 }}>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span className="body-sm">補助標準</span>
              <span className="num" style={{ fontSize: 14, fontWeight: 500 }}>NT$ {subsidy.amount.toLocaleString()} / kW</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span className="body-sm">適用容量</span>
              <span className="num" style={{ fontSize: 14, fontWeight: 500 }}>{capacity} kW</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", paddingTop: 10, borderTop: "1px dashed var(--ink-200)" }}>
              <span className="body-sm" style={{ color: "var(--green-700)", fontWeight: 500 }}>可領補助</span>
              <span className="num" style={{ fontSize: 18, fontWeight: 700, color: "var(--green-700)" }}>− NT$ {subsidyAmount.toLocaleString()}</span>
            </div>
          </div>

          <a href="#" style={{ fontSize: 12, color: "var(--green-700)", textDecoration: "underline", textUnderlineOffset: 3 }}>
            查看 {county} 補助申請辦法 →
          </a>

          <div style={{
            marginTop: 22, padding: "20px 18px",
            background: "var(--green-50)",
            borderRadius: "var(--radius-md)",
            borderLeft: "3px solid var(--green-700)",
          }}>
            <div className="caption">實際自付金額</div>
            <div className="num" style={{ fontSize: 36, fontWeight: 700, color: "var(--green-900)", marginTop: 4 }}>
              NT$ {outOfPocket.toLocaleString()}
            </div>
            <div className="body-sm" style={{ marginTop: 6 }}>
              = 總費用 {totalCost.toLocaleString()} − 補助 {subsidyAmount.toLocaleString()}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

Object.assign(window, { StepAddress, StepUsage, StepGoal, StepParams });
