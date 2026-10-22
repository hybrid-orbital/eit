import "./style.css";
import { defaults, validate, type Config, type Result } from "./solver";
let config: Config = structuredClone(defaults),
  result: Result | undefined,
  shown: Config = structuredClone(config),
  step = 0,
  playing = false,
  showMesh = false;
let pending = false,
  version = 0,
  sent = 0,
  timer: ReturnType<typeof setTimeout> | undefined,
  selected = 0,
  inFlight: Config = structuredClone(config);
const $ = <T extends HTMLElement = HTMLElement>(s: string) =>
  document.querySelector<T>(s)!;
const worker = new Worker(new URL("./worker.ts", import.meta.url), {
  type: "module",
});
const range = (
  key: string,
  title: string,
  min: number,
  max: number,
  increment: number,
  value: number,
  unit = "",
) =>
  `<label class="control"><span>${title}<output id="o-${key}">${value}${unit}</output></span><input aria-label="${title}" data-key="${key}" type="range" min="${min}" max="${max}" step="${increment}" value="${value}" data-unit="${unit}"></label>`;
$("#app").innerHTML = `
<header><a class="brand" href="/" aria-label="EIT Lab 首页"><span class="brand-icon">◉</span> EIT<span>LAB</span><i></i><small>电阻抗成像实验室</small></a><div class="header-right"><span class="local-dot"></span><span>本地计算 · 数据不上传</span><button id="export" class="quiet">↓ 导出实验</button><button id="import" class="quiet">↑ 导入</button><input type="file" id="file" accept="application/json" hidden></div></header>
<div class="workspace"><aside><div class="side-head"><span class="eyebrow">EXPERIMENT SETUP</span><h2>定义你的实验<span>01</span></h2></div><div id="controls"></div><div class="aside-footer"><button id="reset" class="quiet">↺ 恢复默认实验</button><span>二维 · 准静态 · 差分成像</span></div></aside>
<main><div class="intro"><div><div class="eyebrow">THE INVISIBLE, MADE VISIBLE</div><h1>从边界电压，看见内部。</h1><p>构建介质，注入电流，探索电阻抗成像的物理与逆问题。</p></div><div class="run-state"><span id="status-dot" class="local-dot"></span><span id="status" role="status">初始化求解器</span><small id="compute-time">Web Worker / FEM</small></div></div>
<div id="error" role="alert" hidden></div>
<div class="toolbar"><div class="toolbar-left"><span class="live-tag">LIVE EXPERIMENT</span><span id="summary"></span></div><div><button id="mesh-toggle" aria-pressed="false" class="quiet">△ 网格</button><button id="play" class="primary">▶ 播放扫描</button></div></div>
<div class="panels"><section class="panel"><div class="panel-head"><div><span class="panel-num">01 / GROUND TRUTH</span><h3>真实电导率</h3></div><span class="unit">S/m</span></div><div class="canvas-wrap"><canvas id="truth" aria-label="真实电导率场，可拖动目标"></canvas><span class="canvas-caption">拖动目标，实时改变介质</span></div><div class="legend"><span id="sigma-min">0</span><div class="gradient sigma"></div><span id="sigma-max">2</span></div><div class="panel-foot"><span id="target-count"></span><span>圆形目标 · 边界内裁切</span></div></section>
<section class="panel"><div class="panel-head"><div><span class="panel-num">02 / FORWARD MODEL</span><h3>电势与电流场</h3></div><span class="unit">mV</span></div><div class="canvas-wrap"><canvas id="field" aria-label="正向有限元电势与电流方向"></canvas><span class="canvas-caption" id="pair-caption"></span></div><div class="legend"><span id="field-min"></span><div class="gradient diverge"></div><span id="field-max"></span></div><div class="panel-foot"><span>∇ · (σ∇u) = 0</span><span>箭头：电流方向</span></div></section>
<section class="panel"><div class="panel-head"><div><span class="panel-num">03 / INVERSE MODEL</span><h3>EIT 重建结果</h3></div><span class="unit">S/m</span></div><div class="canvas-wrap"><canvas id="recon" aria-label="差分重建电导率"></canvas><span class="canvas-caption">参考介质 + 重建电导率变化</span></div><div class="legend"><span id="recon-min"></span><div class="gradient sigma"></div><span id="recon-max"></span></div><div class="panel-foot"><span>Jacobian + Tikhonov</span><span id="fit-label"></span></div></section></div>
<div class="metrics"><div><span>本次求解</span><strong id="metric-time">—</strong><small id="timing-detail">等待计算</small></div><div><span>有效测量</span><strong id="metric-meas">—</strong><small>排除注流电极相邻测量</small></div><div><span>重建 RMSE</span><strong id="metric-rmse">—</strong><small>与真实电导率的面积加权误差</small></div><div><span>正向相对残差</span><strong id="metric-residual">—</strong><small id="mesh-detail">共轭梯度迭代收敛</small></div></div>
<section class="signals"><div class="signal-head"><div><span class="panel-num">BOUNDARY OBSERVATIONS</span><h3>边界电压响应 <small id="scan-label"></small></h3></div><div class="chart-key"><span><i class="key-ref"></i>均匀参考</span><span><i class="key-meas"></i>当前测量</span><button id="csv" class="quiet">↓ CSV</button></div></div><canvas id="chart" aria-label="当前扫描的参考与测量电压曲线"></canvas><div class="scan-control"><button id="prev" class="quiet" aria-label="上一步">←</button><label for="scan">注流序列</label><input id="scan" type="range" min="0" max="15" value="0" aria-label="注流序列"><span id="scan-count">01 / 16</span><button id="next" class="quiet" aria-label="下一步">→</button></div></section>
<details class="method"><summary>模型说明与计算边界 <span>了解这个实验如何工作 ↗</span></summary><div><p>二维线性三角形有限元，绝缘外边界、边界节点点电极，中心节点固定电势作为规范。坐标表示半径约 0.1 m 的截面，厚度固定 0.1 m。电极按极角均匀分布（非等弧长），每次注流后采集未接触注流电极的相邻电压差。</p><p>频率使用实部色散模型 σ(f)=σ₀[1+D·f²/(f²+f꜀²)]，各介质共用色散系数；电流为正弦幅值，显示同相电压幅值。不包含复介电率、相位、接触阻抗与仪器电路。目标以三角形重心采样，重叠时列表后面的目标优先。</p><p>围绕均匀参考构建伴随 Jacobian，在 16×16 空间分区中求解差分 Tikhonov 逆问题，正则项为 λ·max diag(JᵀJ)。高对比度下线性化误差会增大，重建数值不作正值截断。噪声为参考电压 RMS 百分比的加性高斯噪声，固定种子保证实验可复现。网格与线性化会造成分辨率限制；这是物理教学与算法探索工具。</p><p>方法参考：<a href="https://sce.carleton.ca/faculty/adler/eidors/doc/eidors/solvers/forward/jacobian_adjoint.html" target="_blank" rel="noreferrer">EIDORS 伴随 Jacobian</a>。实现与 EIDORS 独立。</p></div></details>
<footer><span>EIT LAB <b> / </b> COMPUTATIONAL IMAGING PLAYGROUND</span><span>在浏览器中，探索看不见的世界。</span></footer></main></div>`;
function controls() {
  $("#controls").innerHTML =
    `<details open><summary><b>◌</b> 边界与网格 <span>GEOMETRY</span></summary><div class="section-body"><label class="control"><span>边界形状</span><select id="shape"><option value="circle">圆形 / Circle</option><option value="ellipse">椭圆 / Ellipse</option><option value="thorax">胸廓 / Thorax</option><option value="polygon">自定义多边形 / Custom</option></select></label>${config.shape === "ellipse" ? range("aspect", "纵横比", 0.45, 1.4, 0.01, config.aspect) : ""}${config.shape === "polygon" ? `<label class="control"><span>逆时针顶点 · 原点须在内核</span><textarea id="vertices" rows="5" spellcheck="false">${JSON.stringify(config.vertices)}</textarea></label><button id="apply-vertices" class="quiet">应用边界</button><small class="hint">3–32 个 [x,y]，坐标 [-1,1]。支持关于原点的星形多边形。</small>` : ""}<label class="control"><span>电极数量</span><div class="segmented">${[8, 12, 16, 24, 32].map((n) => `<button data-electrodes="${n}" class="${config.electrodes === n ? "active" : ""}">${n}</button>`).join("")}</div></label>${range("rotation", "电极旋转", 0, 359, 1, config.rotation, "°")}${range("rings", "径向网格层数", 4, 14, 1, config.rings)}</div></details>
<details open><summary><b>ϟ</b> 激励与采集 <span>EXCITATION</span></summary><div class="section-body"><label class="control"><span>扫描方案</span><select id="scheme"><option value="adjacent">相邻激励 / Adjacent</option><option value="opposite">对向激励 / Opposite</option><option value="skip">跨距激励 / Skip</option></select></label>${config.scheme === "skip" ? range("skip", "电极跨距", 2, config.electrodes - 1, 1, Math.min(config.skip, config.electrodes - 1)) : ""}${range("frequency", "激励频率", 1, 1000, 1, config.frequency, " kHz")}${range("current", "电流幅值", 0.1, 10, 0.1, config.current, " mA")}${range("noise", "测量噪声", 0, 5, 0.05, config.noise, " % RMS")}</div></details>
<details open><summary><b>◍</b> 介质与目标 <span>PHANTOM</span></summary><div class="section-body">${range("background", "背景电导率 σ₀", 0.1, 3, 0.05, config.background, " S/m")}<div class="target-toolbar"><span>内部目标 <small>${config.inclusions.length} / 8</small></span><button id="add-target" class="quiet" ${config.inclusions.length >= 8 ? "disabled" : ""}>＋ 添加</button></div><div class="targets">${config.inclusions.map((i, k) => `<button data-target="${k}" class="${selected === k ? "active" : ""}"><i style="background:${i.sigma >= config.background ? "#e9a249" : "#5caeb5"}"></i>目标 ${k + 1}</button>`).join("")}</div>${config.inclusions[selected] ? `<div class="target-editor">${range("target.sigma", "目标电导率 σ₀", 0.1, 4, 0.05, config.inclusions[selected].sigma, " S/m")}${range("target.radius", "目标半径", 0.06, 0.5, 0.01, config.inclusions[selected].radius)}${range("target.x", "横向位置 x", -0.95, 0.95, 0.01, config.inclusions[selected].x)}${range("target.y", "纵向位置 y", -0.95, 0.95, 0.01, config.inclusions[selected].y)}<button id="remove-target" class="text-button">移除这个目标</button></div>` : '<p class="hint">均匀介质；添加目标以观察重建。</p>'}<details class="sub-details"><summary>频率色散参数</summary>${range("dispersion", "色散强度 D", 0, 2, 0.05, config.dispersion)}${range("corner", "特征频率 f꜀", 1, 500, 1, config.corner, " kHz")}</details></div></details>
<details open><summary><b>⌁</b> 重建设置 <span>RECONSTRUCTION</span></summary><div class="section-body"><label class="control"><span>正则化 λ<output id="o-lambda">${config.lambda.toExponential(1)}</output></span><input type="range" data-key="lambda" aria-label="正则化" min="-5" max="0" step=".1" value="${Math.log10(config.lambda)}"></label><div class="range-labels"><span>保留细节</span><span>抑制噪声</span></div><p class="hint">与均匀背景比较的差分成像。降低正则化可保留细节，也会放大噪声。</p><label class="control"><span>噪声随机种子</span><input id="seed" type="number" min="0" max="4294967295" value="${config.seed}"></label></div></details>`;
  $("#shape").addEventListener("change", (e) => {
    config.shape = (e.target as HTMLSelectElement).value as Config["shape"];
    controls();
    schedule();
  });
  $<HTMLSelectElement>("#shape").value = config.shape;
  $<HTMLSelectElement>("#scheme").value = config.scheme;
  $("#scheme").addEventListener("change", (e) => {
    config.scheme = (e.target as HTMLSelectElement).value as Config["scheme"];
    controls();
    schedule();
  });
  $("#controls")
    .querySelectorAll<HTMLInputElement>("input[data-key]")
    .forEach((input) =>
      input.addEventListener("input", () => {
        const key = input.dataset.key!,
          value =
            key === "lambda" ? 10 ** Number(input.value) : Number(input.value);
        if (key.startsWith("target."))
          (config.inclusions[selected] as unknown as Record<string, number>)[
            key.split(".")[1]
          ] = value;
        else (config as unknown as Record<string, number>)[key] = value;
        $(`#o-${CSS.escape(key)}`).textContent =
          (key === "lambda"
            ? value.toExponential(1)
            : String(Number(value.toFixed(2)))) + (input.dataset.unit || "");
        schedule();
      }),
    );
  $("#controls")
    .querySelectorAll<HTMLButtonElement>("[data-electrodes]")
    .forEach(
      (b) =>
        (b.onclick = () => {
          config.electrodes = Number(b.dataset.electrodes);
          config.skip = Math.min(config.skip, config.electrodes - 1);
          controls();
          schedule();
        }),
    );
  $("#controls")
    .querySelectorAll<HTMLButtonElement>("[data-target]")
    .forEach(
      (b) =>
        (b.onclick = () => {
          selected = Number(b.dataset.target);
          controls();
          draw();
        }),
    );
  $("#add-target").onclick = () => {
    if (config.inclusions.length >= 8) return;
    config.inclusions.push({ x: 0, y: 0, radius: 0.18, sigma: 1.6 });
    selected = config.inclusions.length - 1;
    controls();
    schedule();
  };
  const remove = $("#remove-target");
  if (remove)
    remove.onclick = () => {
      config.inclusions.splice(selected, 1);
      selected = Math.max(0, selected - 1);
      controls();
      schedule();
    };
  const apply = $("#apply-vertices");
  if (apply)
    apply.onclick = () => {
      try {
        const next = {
          ...config,
          vertices: JSON.parse($<HTMLTextAreaElement>("#vertices").value),
        };
        validate(next);
        config = next;
        schedule();
      } catch (e) {
        error(String(e));
      }
    };
  $("#seed").onchange = () => {
    const v = Number($<HTMLInputElement>("#seed").value);
    if (Number.isInteger(v) && v >= 0 && v <= 4294967295) {
      config.seed = v;
      schedule();
    } else error("随机种子须为 0–4294967295 之间的整数");
  };
}
function error(message: string) {
  $("#error").hidden = false;
  $("#error").textContent = message;
  $("#status").textContent = "配置需要调整";
}
function schedule() {
  version++;
  $("#status").textContent = "正在计算";
  $("#status-dot").classList.add("busy");
  if (!timer)
    timer = setTimeout(() => {
      timer = undefined;
      dispatch();
    }, 30);
}
function dispatch() {
  if (pending) return;
  try {
    validate(config);
  } catch (e) {
    error(String(e));
    return;
  }
  pending = true;
  sent = version;
  worker.postMessage({ id: sent, config: structuredClone(config) });
  inFlight = structuredClone(config);
}
worker.onmessage = (e) => {
  pending = false;
  if (e.data.id !== version) {
    dispatch();
    return;
  }
  $("#status-dot").classList.remove("busy");
  if (e.data.error) {
    error(e.data.error);
    return;
  }
  shown = inFlight;
  result = e.data.result;
  $("#error").hidden = true;
  $("#status").textContent = "仿真已同步";
  step %= result!.pairs.length;
  update();
};
worker.onerror = (e) => {
  pending = false;
  error(`计算线程异常：${e.message}`);
};
function update() {
  if (!result) return;
  const r = result;
  $("#summary").textContent =
    `${shown.electrodes} 电极 / ${shown.frequency} kHz / ${shown.current.toFixed(1)} mA`;
  $("#compute-time").textContent =
    `${r.timing.total.toFixed(0)} ms / ${r.timing.cached ? "参考缓存命中" : "参考已更新"}`;
  $("#metric-time").innerHTML = `${r.timing.total.toFixed(0)} <em>ms</em>`;
  $("#timing-detail").textContent =
    `参考 ${r.timing.prepare.toFixed(0)} · 正向 ${r.timing.forward.toFixed(0)} · 重建 ${r.timing.inverse.toFixed(0)} ms`;
  $("#metric-meas").innerHTML = `${r.measured.length} <em>组</em>`;
  $("#metric-rmse").innerHTML = `${r.rmse.toFixed(3)} <em>S/m</em>`;
  $("#metric-residual").textContent = r.residual.toExponential(1);
  $("#mesh-detail").textContent =
    `${r.mesh.points.length} 节点 · ${r.mesh.triangles.length} 单元`;
  $("#target-count").textContent =
    `${shown.inclusions.length} 个目标 / σ背景 ${r.baseSigma.toFixed(2)} S/m`;
  $("#fit-label").textContent = `电压拟合误差 ${(r.fit * 100).toFixed(1)}%`;
  $<HTMLInputElement>("#scan").max = String(r.pairs.length - 1);
  draw();
}
function canvas(id: string) {
  const el = $<HTMLCanvasElement>(id),
    rect = el.getBoundingClientRect(),
    dpr = window.devicePixelRatio || 1;
  el.width = Math.round(rect.width * dpr);
  el.height = Math.round(rect.height * dpr);
  const ctx = el.getContext("2d")!;
  ctx.scale(dpr, dpr);
  return { ctx, w: rect.width, h: rect.height };
}
function color(t: number, div = false) {
  t = Math.max(0, Math.min(1, t));
  const stops = div
    ? [
        [59, 113, 157],
        [228, 235, 218],
        [220, 125, 76],
      ]
    : [
        [37, 103, 119],
        [135, 185, 173],
        [235, 227, 181],
        [235, 164, 77],
        [181, 83, 44],
      ];
  const p = t * (stops.length - 1),
    i = Math.min(stops.length - 2, Math.floor(p)),
    f = p - i;
  return `rgb(${stops[i].map((v, k) => Math.round(v * (1 - f) + stops[i + 1][k] * f)).join(",")})`;
}
function draw() {
  if (!result) return;
  const r = result,
    [source, sink] = r.pairs[step],
    sigmaMin = Math.min(...r.sigma, ...r.reconstructed),
    sigmaMax = Math.max(...r.sigma, ...r.reconstructed),
    span = Math.max(0.1, sigmaMax - sigmaMin);
  let fieldMin = Infinity,
    fieldMax = -Infinity;
  for (const v of r.fields[step]) {
    fieldMin = Math.min(fieldMin, v);
    fieldMax = Math.max(fieldMax, v);
  }
  const mid = (fieldMin + fieldMax) / 2,
    extent = Math.max(1e-9, (fieldMax - fieldMin) / 2);
  for (const id of ["truth", "field", "recon"]) {
    const { ctx, w, h } = canvas("#" + id),
      s = Math.min(w, h) * 0.405,
      cx = w / 2,
      cy = h / 2 - 6;
    const xy = (p: number[]) => [cx + p[0] * s, cy - p[1] * s];
    ctx.clearRect(0, 0, w, h);
    ctx.strokeStyle = "#e5e8df";
    ctx.lineWidth = 0.5;
    for (let k = -4; k <= 4; k++) {
      ctx.beginPath();
      ctx.moveTo(cx + (k * s) / 4, cy - s);
      ctx.lineTo(cx + (k * s) / 4, cy + s);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(cx - s, cy + (k * s) / 4);
      ctx.lineTo(cx + s, cy + (k * s) / 4);
      ctx.stroke();
    }
    r.mesh.triangles.forEach((t, k) => {
      const v =
        id === "truth"
          ? r.sigma[k]
          : id === "recon"
            ? r.reconstructed[k]
            : t.ids.reduce((a, i) => a + r.fields[step][i], 0) / 3;
      ctx.fillStyle =
        id === "field"
          ? color(0.5 + (v - mid) / (2 * extent), true)
          : color((v - sigmaMin) / span);
      ctx.beginPath();
      t.ids.forEach((i, j) => {
        const [x, y] = xy(r.mesh.points[i]);
        j ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
      });
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = showMesh ? "#234b4240" : ctx.fillStyle;
      ctx.lineWidth = showMesh ? 0.5 : 0.6;
      ctx.stroke();
    });
    if (id === "field") {
      ctx.strokeStyle = "#28474488";
      ctx.lineWidth = 1;
      for (let k = 0; k < r.mesh.triangles.length; k += 7) {
        const t = r.mesh.triangles[k];
        let x = 0,
          y = 0;
        for (let q = 0; q < 3; q++) {
          x -= t.gx[q] * r.fields[step][t.ids[q]];
          y -= t.gy[q] * r.fields[step][t.ids[q]];
        }
        const mag = Math.hypot(x, y);
        if (mag < 1e-12) continue;
        const [px, py] = xy([t.x, t.y]),
          dx = (x / mag) * 6,
          dy = (-y / mag) * 6;
        ctx.beginPath();
        ctx.moveTo(px - dx / 2, py - dy / 2);
        ctx.lineTo(px + dx / 2, py + dy / 2);
        ctx.lineTo(
          px + dx / 2 - dx * 0.35 + dy * 0.3,
          py + dy / 2 - dy * 0.35 - dx * 0.3,
        );
        ctx.moveTo(px + dx / 2, py + dy / 2);
        ctx.lineTo(
          px + dx / 2 - dx * 0.35 - dy * 0.3,
          py + dy / 2 - dy * 0.35 + dx * 0.3,
        );
        ctx.stroke();
      }
    }
    ctx.strokeStyle = "#476358";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    r.mesh.boundary.forEach((p, k) => {
      const [x, y] = xy(p);
      k ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
    });
    ctx.closePath();
    ctx.stroke();
    r.mesh.electrodes.forEach((node, k) => {
      const p = r.mesh.points[node],
        [x, y] = xy(p),
        active = id === "field" && (k === source || k === sink);
      ctx.fillStyle = active
        ? k === source
          ? "#d88736"
          : "#398bab"
        : "#f7f7ef";
      ctx.strokeStyle = active ? ctx.fillStyle : "#587064";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(x, y, active ? 5 : 3.2, 0, 2 * Math.PI);
      ctx.fill();
      ctx.stroke();
      const mag = Math.hypot(...p);
      ctx.fillStyle = "#64766c";
      ctx.font = "9px ui-monospace, monospace";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(
        String(k + 1).padStart(2, "0"),
        x + (p[0] / mag) * 15,
        y - (p[1] / mag) * 15,
      );
    });
    if (id === "truth")
      shown.inclusions.forEach((t, k) => {
        const [x, y] = xy([t.x, t.y]);
        ctx.strokeStyle = k === selected ? "#fff" : "#ffffff99";
        ctx.lineWidth = k === selected ? 1.8 : 1;
        ctx.setLineDash([4, 3]);
        ctx.beginPath();
        ctx.arc(x, y, t.radius * s, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = "#243f36";
        ctx.font = "bold 10px sans-serif";
        ctx.textAlign = "center";
        ctx.fillText(String(k + 1), x, y + 3);
      });
  }
  for (const p of ["sigma", "recon"]) {
    $("#" + p + "-min").textContent = sigmaMin.toFixed(2);
    $("#" + p + "-max").textContent = (sigmaMin + span).toFixed(2);
  }
  $("#field-min").textContent = (fieldMin * 1000).toFixed(1);
  $("#field-max").textContent = (fieldMax * 1000).toFixed(1);
  $("#pair-caption").textContent = `注流 E${source + 1} (+) → E${sink + 1} (−)`;
  $("#scan-label").textContent = `/ 注流 ${String(step + 1).padStart(2, "0")}`;
  $("#scan-count").textContent =
    `${String(step + 1).padStart(2, "0")} / ${shown.electrodes}`;
  $<HTMLInputElement>("#scan").value = String(step);
  drawChart();
}
function drawChart() {
  if (!result) return;
  const r = result,
    { ctx, w, h } = canvas("#chart"),
    ids = r.measurements
      .map((m, i) => (m[0] === step ? i : -1))
      .filter((i) => i >= 0),
    left = 65,
    right = w - 25,
    top = 20,
    bottom = h - 28;
  const values = ids.flatMap((i) => [
    r.baseline[i] * 1000,
    r.measured[i] * 1000,
  ]);
  let min = Math.min(...values),
    max = Math.max(...values);
  const span = Math.max(max - min, 0.01);
  min -= span * 0.15;
  max += span * 0.15;
  ctx.font = "10px ui-monospace, monospace";
  for (let k = 0; k <= 4; k++) {
    const y = top + ((bottom - top) * k) / 4;
    ctx.strokeStyle = "#e6e8e0";
    ctx.beginPath();
    ctx.moveTo(left, y);
    ctx.lineTo(right, y);
    ctx.stroke();
    ctx.fillStyle = "#7a867c";
    ctx.textAlign = "right";
    ctx.fillText((max - ((max - min) * k) / 4).toFixed(2), left - 12, y + 3);
  }
  ctx.fillText("mV", left - 12, 10);
  for (const [data, col, dash] of [
    [r.baseline, "#9ea99a", [4, 4]],
    [r.measured, "#287b66", []],
  ] as const) {
    ctx.strokeStyle = col;
    ctx.lineWidth = 2;
    ctx.setLineDash([...dash]);
    ctx.beginPath();
    ids.forEach((i, k) => {
      const x = left + (k / (ids.length - 1)) * (right - left),
        y = bottom - ((data[i] * 1000 - min) / (max - min)) * (bottom - top);
      k ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
    });
    ctx.stroke();
    ctx.setLineDash([]);
  }
  ctx.textAlign = "center";
  ids.forEach((i, k) => {
    const x = left + (k / (ids.length - 1)) * (right - left),
      y =
        bottom - ((r.measured[i] * 1000 - min) / (max - min)) * (bottom - top);
    ctx.fillStyle = "#287b66";
    ctx.beginPath();
    ctx.arc(x, y, 2.5, 0, Math.PI * 2);
    ctx.fill();
    if (ids.length < 18 || k % 2 === 0) {
      ctx.fillStyle = "#7a867c";
      ctx.fillText(
        `${r.measurements[i][1] + 1}–${r.measurements[i][2] + 1}`,
        x,
        h - 7,
      );
    }
  });
}
function download(name: string, data: string, type: string) {
  const url = URL.createObjectURL(new Blob([data], { type })),
    a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
$("#export").onclick = () =>
  download(
    "eit-experiment.json",
    JSON.stringify({ version: 1, config }, null, 2),
    "application/json",
  );
$("#import").onclick = () => $<HTMLInputElement>("#file").click();
$("#file").onchange = async () => {
  const input = $<HTMLInputElement>("#file");
  try {
    const f = input.files?.[0];
    if (!f) return;
    if (f.size > 100000) throw new Error("文件过大");
    const data = JSON.parse(await f.text());
    if (data.version !== 1) throw new Error("不支持的实验版本");
    validate(data.config);
    config = data.config;
    selected = 0;
    step = 0;
    controls();
    schedule();
  } catch (e) {
    error(`导入失败：${String(e)}`);
  } finally {
    input.value = "";
  }
};
$("#csv").onclick = () => {
  if (!result) return;
  const r = result;
  download(
    "eit-measurements.csv",
    "drive_positive,drive_negative,sense_positive,sense_negative,reference_V,measured_V,delta_V\n" +
      r.measurements
        .map(
          ([d, a, b], i) =>
            `${r.pairs[d][0] + 1},${r.pairs[d][1] + 1},${a + 1},${b + 1},${r.baseline[i]},${r.measured[i]},${r.delta[i]}`,
        )
        .join("\n"),
    "text/csv",
  );
};
$("#reset").onclick = () => {
  config = structuredClone(defaults);
  selected = 0;
  step = 0;
  controls();
  schedule();
};
$("#mesh-toggle").onclick = () => {
  showMesh = !showMesh;
  $("#mesh-toggle").setAttribute("aria-pressed", String(showMesh));
  draw();
};
$("#play").onclick = () => {
  playing = !playing;
  $("#play").textContent = playing ? "Ⅱ 暂停扫描" : "▶ 播放扫描";
};
setInterval(() => {
  if (playing && result) {
    step = (step + 1) % result.pairs.length;
    draw();
  }
}, 450);
$("#prev").onclick = () => {
  if (result) {
    step = (step + result.pairs.length - 1) % result.pairs.length;
    draw();
  }
};
$("#next").onclick = () => {
  if (result) {
    step = (step + 1) % result.pairs.length;
    draw();
  }
};
$("#scan").oninput = () => {
  step = Number($<HTMLInputElement>("#scan").value);
  draw();
};
let dragging = false;
const truth = $<HTMLCanvasElement>("#truth");
function position(e: PointerEvent) {
  const rect = truth.getBoundingClientRect(),
    s = Math.min(rect.width, rect.height) * 0.405;
  return {
    x: Math.max(
      -0.95,
      Math.min(0.95, (e.clientX - rect.left - rect.width / 2) / s),
    ),
    y: Math.max(
      -0.95,
      Math.min(0.95, -(e.clientY - rect.top - rect.height / 2 + 6) / s),
    ),
  };
}
truth.onpointerdown = (e) => {
  const p = position(e);
  const i = config.inclusions.findLastIndex(
    (t) => Math.hypot(t.x - p.x, t.y - p.y) < t.radius,
  );
  if (i >= 0) {
    selected = i;
    dragging = true;
    truth.setPointerCapture(e.pointerId);
    controls();
    draw();
  }
};
truth.onpointermove = (e) => {
  if (!dragging) return;
  const p = position(e);
  Object.assign(config.inclusions[selected], {
    x: Number(p.x.toFixed(2)),
    y: Number(p.y.toFixed(2)),
  });
  for (const k of ["x", "y"]) {
    const v = config.inclusions[selected][k as "x" | "y"];
    $<HTMLInputElement>(`[data-key="target.${k}"]`).value = String(v);
    $(`#o-target\\.${k}`).textContent = String(v);
  }
  schedule();
};
truth.onpointerup = truth.onpointercancel = () => {
  dragging = false;
};
new ResizeObserver(() => draw()).observe($("main"));
controls();
schedule();
