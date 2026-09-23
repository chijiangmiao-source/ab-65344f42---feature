import { useCallback, useMemo, useRef, useState } from 'react';
import {
  formatBigIntDecimal,
  tokenMagnitude,
  tokenToSigned,
  validatePermutation,
  type Token,
} from './lib/permutation';
import {
  advanceDisplay,
  arcMagnitudes,
  fromDTO,
  relativeOrientation,
  sameCircularState,
  solve,
  toDTO,
  type AuditResult,
  type AuditResultDTO,
  type IntervalCell,
  type Topology,
} from './lib/solver';
import type { AuditRequest } from './audit.worker';

const EXAMPLES = [
  '1,-3,-2,4',
  '-1,-2,-3',
  '3,2,1',
  '-7,6,-5,4,-3,2,-1',
];

interface SelectedCell {
  depth: number;
  start: number;
  end: number;
}

export function App() {
  const [input, setInput] = useState('1,-3,-2,4');
  const [topology, setTopology] = useState<Topology>('linear');
  const [errors, setErrors] = useState<string[]>([]);
  const [result, setResult] = useState<AuditResult | null>(null);
  const [computing, setComputing] = useState(false);
  // 当前查看的深度（0 表示尚未执行任何倒位）。
  const [activeDepth, setActiveDepth] = useState(0);
  const [selected, setSelected] = useState<SelectedCell | null>(null);
  const workerRef = useRef<Worker | null>(null);
  // 每次审计一个序号；切换拓扑或重新审计后，旧 Worker 回执一律丢弃。
  const requestSeq = useRef(0);

  const switchTopology = useCallback(
    (next: Topology) => {
      if (topology === next) return;
      // 切换拓扑：清空上一模式的全部结果与选中深度，不复用任何审计产物。
      requestSeq.current += 1;
      setTopology(next);
      setResult(null);
      setErrors([]);
      setSelected(null);
      setActiveDepth(0);
      setComputing(false);
    },
    [topology],
  );

  const runAudit = useCallback(() => {
    const { tokens, errors: validationErrors } = validatePermutation(input);
    // 无论合法与否，输入文本都原样保留；错误合并为一次反馈。
    setErrors(validationErrors);
    if (!tokens) {
      setResult(null);
      return;
    }

    const seq = requestSeq.current + 1;
    requestSeq.current = seq;
    setComputing(true);
    setResult(null);
    setSelected(null);
    setActiveDepth(0);

    const finish = (dto: AuditResultDTO) => {
      // 过期回执（拓扑已切换或又触发了一次审计）直接丢弃。
      if (seq !== requestSeq.current) return;
      if (dto.topology !== topology) return;
      setResult(fromDTO(dto));
      setComputing(false);
    };

    try {
      if (!workerRef.current) {
        workerRef.current = new Worker(
          new URL('./audit.worker.ts', import.meta.url),
          { type: 'module' },
        );
      }
      const worker = workerRef.current;
      worker.onmessage = (event: MessageEvent<AuditResultDTO>) =>
        finish(event.data);
      const message: AuditRequest = { tokens, topology };
      worker.postMessage(message);
    } catch {
      // Worker 不可用时退回主线程求解（功能不降级，仅可能短暂阻塞）。
      finish(toDTO(solve(tokens, topology)));
    }
  }, [input, topology]);

  return (
    <main className="page">
      <header className="header">
        <h1>带符号标记排列 · 规范倒位审计</h1>
        <p className="subtitle">
          浏览器内对全部最短方案做精确枚举：最少步数、任意精度方案总数、
          按每步操作对字典序选出的规范方案，以及逐深度操作出现矩阵。
          支持线性与环状两种拓扑；所有计算均在本机完成，无后端、无网络请求。
        </p>
      </header>

      <section className="card" aria-label="排列输入">
        <label className="field-label" htmlFor="perm-input">
          带符号排列（3 至 7 个标记，绝对值须恰好为 1 至 n 且互异）
        </label>

        <div className="topo-switch" role="radiogroup" aria-label="拓扑类型">
          <button
            type="button"
            role="radio"
            aria-checked={topology === 'linear'}
            className={`topo-option ${topology === 'linear' ? 'topo-active' : ''}`}
            onClick={() => switchTopology('linear')}
          >
            <span className="topo-title">线性拓扑</span>
            <span className="topo-note">固定首标记与观察方向，闭区间 [起,止]</span>
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={topology === 'circular'}
            className={`topo-option ${topology === 'circular' ? 'topo-active' : ''}`}
            onClick={() => switchTopology('circular')}
          >
            <span className="topo-title">环状拓扑</span>
            <span className="topo-note">旋转 / 整体反向翻号等价，两切口定一段弧</span>
          </button>
        </div>

        <textarea
          id="perm-input"
          className="perm-input"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          rows={2}
          spellCheck={false}
          placeholder={topology === 'circular' ? '例如：-1,-2,-3（环上即正向环序）' : '例如：1,-3,-2,4'}
        />
        <div className="examples">
          <span className="muted">示例：</span>
          {EXAMPLES.map((ex) => (
            <button
              key={ex}
              type="button"
              className="chip"
              onClick={() => setInput(ex)}
            >
              {ex}
            </button>
          ))}
        </div>
        <div className="actions">
          <button
            type="button"
            className="primary"
            onClick={runAudit}
            disabled={computing}
          >
            {computing ? '审计进行中…' : `启动${topology === 'circular' ? '环状' : '线性'}审计`}
          </button>
          {computing && <span className="muted">n=7 最坏情况约需数秒</span>}
        </div>
        {errors.length > 0 && (
          <div className="alert" role="alert">
            <strong>输入不合法，请一并修正：</strong>
            <ul>
              {errors.map((msg, idx) => (
                <li key={idx}>{msg}</li>
              ))}
            </ul>
          </div>
        )}
      </section>

      {result && (
        <ResultView
          result={result}
          activeDepth={activeDepth}
          setActiveDepth={setActiveDepth}
          selected={selected}
          setSelected={setSelected}
        />
      )}

      <footer className="footer muted">
        {topology === 'linear'
          ? '线性倒位语义：选取闭区间 [i,j]，反转区间内标记次序并同时翻转每个符号。'
          : '环状倒位语义：切口 k 位于位置 k 与 k+1 之间（n 后接 1），两个不同切口确定一段弧；反转弧内标记次序并翻号。互补弧与循环旋转/整体反向翻号不另计，整环操作无效。'}
      </footer>
    </main>
  );
}

function ResultView({
  result,
  activeDepth,
  setActiveDepth,
  selected,
  setSelected,
}: {
  result: AuditResult;
  activeDepth: number;
  setActiveDepth: (d: number) => void;
  selected: SelectedCell | null;
  setSelected: (s: SelectedCell | null) => void;
}) {
  const { distance, totalPaths, canonical, matrix } = result;
  const circular = result.topology === 'circular';

  const currentStep =
    activeDepth < distance ? canonical.steps[activeDepth] : null;

  const jumpToDepth = useCallback(
    (cell: IntervalCell, depth: number) => {
      setActiveDepth(depth);
      setSelected({ depth, start: cell.start, end: cell.end });
    },
    [setActiveDepth, setSelected],
  );

  return (
    <>
      <section className="card summary" aria-label="审计结论">
        <div className="stat">
          <div className="stat-value">{distance}</div>
          <div className="stat-label">最少倒位步数</div>
        </div>
        <div className="stat">
          <div className="stat-value big" title={totalPaths.toString()}>
            {formatBigIntDecimal(totalPaths)}
          </div>
          <div className="stat-label">最短方案总数（精确十进制）</div>
        </div>
        <div className="stat">
          <div className="stat-value">{result.n}</div>
          <div className="stat-label">标记数 n</div>
        </div>
        <div className="stat">
          <div className="stat-value">{circular ? '环状' : '线性'}</div>
          <div className="stat-label">拓扑模式</div>
        </div>
      </section>

      <section className="card" aria-label="规范方案轨迹">
        <h2>规范方案轨迹</h2>
        <p className="muted">
          {distance === 0
            ? circular
              ? '输入环与正向环序等价（仅差旋转或整体反向翻号），无需倒位。'
              : '输入已是全正顺序，无需倒位。'
            : circular
              ? '全部最短方案中，按每步 (切口 a, 切口 b) 序列字典序选出；每个状态以其规范表示（全部旋转/反向翻号表示中的字典序最小者）命名。可单步查看：'
              : '在全部最短方案中，按每步 (起, 止) 下标对序列的字典序选出。可单步查看：'}
        </p>

        {distance > 0 && (
          <Trajectory
            result={result}
            activeDepth={activeDepth}
            setActiveDepth={(d) => {
              // 手动浏览深度时清除矩阵选中，避免高亮仍指向旧深度。
              setSelected(null);
              setActiveDepth(d);
            }}
            selected={selected}
          />
        )}

        {currentStep && (
          <p className="step-hint">
            {circular ? (
              <>
                第 {activeDepth + 1} 步：在当前规范环序上取切口对{' '}
                <strong>
                  ({currentStep.start}, {currentStep.end})
                </strong>
                ，倒转规范表示中位置 {currentStep.start + 1} 至 {currentStep.end}{' '}
                这段弧上的标记并翻号（切口 {currentStep.start} 在位置{' '}
                {currentStep.start} 与 {currentStep.start === result.n ? 1 : currentStep.start + 1}{' '}
                之间，切口 {currentStep.end} 在位置 {currentStep.end} 与{' '}
                {currentStep.end === result.n ? 1 : currentStep.end + 1} 之间；切口 n 即 n 与 1 之间）。
              </>
            ) : (
              <>
                第 {activeDepth + 1} 步：对闭区间{' '}
                <strong>
                  [{currentStep.start}, {currentStep.end}]
                </strong>{' '}
                执行倒位（反转次序并翻转符号）。
              </>
            )}
          </p>
        )}
      </section>

      {distance > 0 && (
        <section className="card" aria-label="深度操作矩阵">
          <h2>{circular ? '深度 × 切口对出现矩阵' : '深度 × 区间出现矩阵'}</h2>
          <Legend
            circular={circular}
            selected={selected}
            cell={
              selected
                ? matrix[selected.depth]?.intervals.find(
                    (c) => c.start === selected.start && c.end === selected.end,
                  ) ?? null
                : null
            }
          />
          <div className="table-wrap">
            <table className="matrix">
              <thead>
                <tr>
                  <th className="corner">
                    深度 ＼ {circular ? '切口对' : '区间'}
                  </th>
                  {matrix[0].intervals.map((cell) => (
                    <th key={`${cell.start}-${cell.end}`}>
                      {circular
                        ? `${cell.start},${cell.end}`
                        : `${cell.start}-${cell.end}`}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {matrix.map((layer) => {
                  const canon = canonical.steps[layer.depth];
                  return (
                    <tr key={layer.depth}>
                      <th scope="row" className="rowhead">
                        第 {layer.depth + 1} 步
                      </th>
                      {layer.intervals.map((cell) => {
                        const isCanonical =
                          canon.start === cell.start && canon.end === cell.end;
                        const isSelected =
                          selected?.depth === layer.depth &&
                          selected.start === cell.start &&
                          selected.end === cell.end;
                        const dimmed =
                          selected !== null && !isSelected && !isCanonical;
                        return (
                          <td key={`${cell.start}-${cell.end}`}>
                            <button
                              type="button"
                              className={[
                                'cell',
                                `cell-${cell.presence}`,
                                isCanonical ? 'cell-canonical' : '',
                                isSelected ? 'cell-selected' : '',
                                dimmed ? 'cell-dimmed' : '',
                              ].join(' ')}
                              onClick={() => jumpToDepth(cell, layer.depth)}
                              title={cellTitle(cell, circular)}
                            >
                              <span className="cell-count">
                                {formatBigIntDecimal(cell.pathCount)}
                              </span>
                            </button>
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="muted small">
            每格数字为：在该深度选择该{circular ? '切口对' : '区间'}的最短方案数量（bigint 精确计数），
            每行之和等于方案总数。
            {circular &&
              '同一状态对之间由互补弧或不同表示产生的重复边只计一次，并以当前规范表示下字典序最小的切口对命名。'}
            加粗描边格为规范方案在该深度的选择；点击任意格，
            {circular ? '环形轨迹将高亮该切口对确定的实际弧段。' : '轨迹视图联动跳转到对应深度。'}
          </p>
        </section>
      )}
    </>
  );
}

function cellTitle(cell: IntervalCell, circular: boolean): string {
  const scope =
    cell.presence === 'all'
      ? '全部最短方案'
      : cell.presence === 'some'
        ? '部分最短方案'
        : '任何最短方案中均未出现';
  const name = circular
    ? `切口对 (${cell.start}, ${cell.end})`
    : `区间 [${cell.start}, ${cell.end}]`;
  return `${name}：${scope}，出现于 ${cell.pathCount} 个最短方案`;
}

function Legend({
  circular,
  selected,
  cell,
}: {
  circular: boolean;
  selected: SelectedCell | null;
  cell: IntervalCell | null;
}) {
  const opName = circular ? '切口对' : '区间';
  return (
    <div className="legend">
      <span className="legend-item">
        <i className="swatch swatch-all" /> 全部方案均出现
      </span>
      <span className="legend-item">
        <i className="swatch swatch-some" /> 仅部分方案出现
      </span>
      <span className="legend-item">
        <i className="swatch swatch-none" /> 任何最短方案均未出现
      </span>
      <span className="legend-item">
        <i className="swatch swatch-canonical" /> 规范方案选择
      </span>
      {selected && cell && (
        <span className="legend-note" role="status">
          已选第 {selected.depth + 1} 步{opName}{' '}
          {circular
            ? `(${selected.start}, ${selected.end})`
            : `[${selected.start}, ${selected.end}]`}
          {circular
            ? cell.onCanonical
              ? '，该弧段就在所示规范环序上，已在环形轨迹中高亮。'
              : cell.pathCount === 0n
                ? '。任何最短方案都不在此深度使用该切口对，故无实际弧段可高亮。'
                : '。该切口对的名字来自此深度另一个等价状态的规范表示，环形轨迹展示其实际弧段的见证态。'
            : '，该倒位不在规范轨迹上（规范选择见描边格）。'}
        </span>
      )}
    </div>
  );
}

function Trajectory({
  result,
  activeDepth,
  setActiveDepth,
  selected,
}: {
  result: AuditResult;
  activeDepth: number;
  setActiveDepth: (d: number) => void;
  selected: SelectedCell | null;
}) {
  const { canonical, distance } = result;

  // 环状模式：构造一条“显示链”——每一步沿用前一帧的旋转与朝向，只让弧内
  // 标记移动/翻号，从而逐步浏览时不会因重新规范化而让标记跳到错误位置。
  // 每帧在商空间中与该深度的规范状态一致（DEV 下断言守护）。
  const frames = useMemo<Token[][] | null>(() => {
    if (result.topology !== 'circular') return null;
    const chain: Token[][] = [canonical.states[0].slice()];
    for (let d = 0; d < distance; d += 1) {
      const step = canonical.steps[d];
      const hit = arcMagnitudes(canonical.states[d], step.start, step.end);
      chain.push(advanceDisplay(chain[d], hit));
      if (import.meta.env.DEV && !sameCircularState(chain[d + 1], canonical.states[d + 1])) {
        throw new Error(`环状显示帧在深度 ${d + 1} 与规范态不一致`);
      }
    }
    return chain;
  }, [result, canonical, distance]);

  const step = activeDepth < distance ? canonical.steps[activeDepth] : null;
  const selectedCell =
    result.topology === 'circular' && selected && selected.depth === activeDepth
      ? result.matrix[activeDepth]?.intervals.find(
          (c) => c.start === selected.start && c.end === selected.end,
        ) ?? null
      : null;
  const showWitness =
    step !== null &&
    selectedCell !== null &&
    selectedCell.witness !== undefined &&
    !(selectedCell.start === step.start && selectedCell.end === step.end);

  // 显示帧可能相对规范态整体反向：用相对朝向判定两个几何端点刻度与规范
  // 切口名是否需要互换（倒位时两个物理切口不动，前/后帧共用此判定）。
  const swappedForStep =
    step !== null && frames !== null
      ? relativeOrientation(
          frames[activeDepth],
          canonical.states[activeDepth],
        ) === 'opposite'
      : false;

  return (
    <div>
      <div className="stepper">
        <button
          type="button"
          onClick={() => setActiveDepth(Math.max(0, activeDepth - 1))}
          disabled={activeDepth === 0}
        >
          ← 上一步
        </button>
        <span className="stepper-pos">
          深度 {activeDepth} / {distance}
        </span>
        <button
          type="button"
          onClick={() => setActiveDepth(Math.min(distance, activeDepth + 1))}
          disabled={activeDepth === distance}
        >
          下一步 →
        </button>
      </div>

      {result.topology === 'linear' ? (
        <LinearStates result={result} activeDepth={activeDepth} />
      ) : (
        frames &&
        (step && !showWitness ? (
          <div className="states">
            <RingFrame
              tokens={frames[activeDepth]}
              boundNames={{ a: step.start, b: step.end }}
              swapped={swappedForStep}
              labelAllCuts={activeDepth === 0}
              caption={
                activeDepth === 0
                  ? `深度 0 的规范环序`
                  : `深度 ${activeDepth} 的环序（沿用深度 0 坐标）`
              }
              hitMagnitudes={arcMagnitudes(
                canonical.states[activeDepth],
                step.start,
                step.end,
              )}
            />
            <div className="arrow" aria-hidden="true">
              → ({step.start},{step.end})
            </div>
            <RingFrame
              tokens={frames[activeDepth + 1]}
              boundNames={{ a: step.start, b: step.end }}
              swapped={swappedForStep}
              labelAllCuts={false}
              caption="同一坐标，执行后（两个物理切口位置不变）"
              hitMagnitudes={arcMagnitudes(
                canonical.states[activeDepth],
                step.start,
                step.end,
              )}
              muted
            />
          </div>
        ) : showWitness && selectedCell?.witness ? (
          <div className="states">
            <RingFrame
              tokens={selectedCell.witness}
              boundNames={{ a: selectedCell.start, b: selectedCell.end }}
              labelAllCuts
              caption={`深度 ${activeDepth} 的见证态（该切口对在此规范表示上命名）`}
              hitMagnitudes={arcMagnitudes(
                selectedCell.witness,
                selectedCell.start,
                selectedCell.end,
              )}
            />
            <div className="arrow" aria-hidden="true">
              → ({selectedCell.start},{selectedCell.end})
            </div>
            <RingFrame
              tokens={advanceDisplay(
                selectedCell.witness,
                arcMagnitudes(
                  selectedCell.witness,
                  selectedCell.start,
                  selectedCell.end,
                ),
              )}
              boundNames={{ a: selectedCell.start, b: selectedCell.end }}
              labelAllCuts={false}
              caption="同一见证表示，执行后"
              hitMagnitudes={arcMagnitudes(
                selectedCell.witness,
                selectedCell.start,
                selectedCell.end,
              )}
              muted
            />
          </div>
        ) : (
          <div className="states">
            <RingFrame
              tokens={frames[activeDepth]}
              boundNames={null}
              labelAllCuts={activeDepth === 0}
              caption={`深度 ${activeDepth}${activeDepth > 0 ? '（沿用深度 0 坐标）' : ''}`}
              hitMagnitudes={null}
              muted={activeDepth === distance}
            />
          </div>
        ))
      )}

      <input
        className="scrub"
        type="range"
        min={0}
        max={distance}
        value={activeDepth}
        onChange={(e) => setActiveDepth(Number(e.target.value))}
        aria-label="选择查看的深度"
      />
    </div>
  );
}

function LinearStates({
  result,
  activeDepth,
}: {
  result: AuditResult;
  activeDepth: number;
}) {
  const { canonical, distance } = result;
  const states = canonical.states;
  const current = states[activeDepth];
  const next = activeDepth < distance ? states[activeDepth + 1] : null;
  const step = activeDepth < distance ? canonical.steps[activeDepth] : null;

  const positions = new Set<number>();
  if (step) {
    // 当前态中哪些位置落在本步倒位区间内（倒位后位置不变，仅次序与符号变）
    for (let k = step.start - 1; k <= step.end - 1; k += 1) positions.add(k);
  }

  return (
    <div className="states">
      <StateRow tokens={current} marks={positions} caption={`深度 ${activeDepth}（执行前）`} />
      {step && (
        <div className="arrow" aria-hidden="true">
          → [{step.start},{step.end}]
        </div>
      )}
      {next && (
        <StateRow tokens={next} marks={positions} caption={`深度 ${activeDepth + 1}（执行后）`} muted />
      )}
    </div>
  );
}

/** 环形轨迹单帧：标记均匀排布在圆周上，外圈为切口编号，粗弧为实际倒位弧段。 */
function RingFrame({
  tokens,
  hitMagnitudes,
  boundNames,
  swapped = false,
  labelAllCuts,
  caption,
  muted = false,
}: {
  tokens: Token[];
  /** 弧上标记的绝对值集合（与表示无关的身份标识）。 */
  hitMagnitudes: Set<number> | null;
  /**
   * 弧两个几何端点在“该帧所采用的编号系”下的切口名。
   * labelAllCuts=true（规范/见证表示）时即规范切口名 (start,end)；
   * labelAllCuts=false（沿用深度 0 坐标系的显示帧）时仍标注当前步的
   * 规范切口名，但只在两个端点刻度上写出，避免误标其它切口。
   */
  boundNames: { a: number; b: number } | null;
  /**
   * 显示帧（labelAllCuts=false）下几何弧端点与切口名是否互换：显示坐标
   * 可能相对规范态整体反向。由执行前帧统一判定，前/后帧共用（倒位时
   * 两个物理切口位置不动）。
   */
  swapped?: boolean;
  /** 是否标注全部切口编号（仅在该帧本身就是规范表示时为真）。 */
  labelAllCuts: boolean;
  caption: string;
  muted?: boolean;
}) {
  const n = tokens.length;
  const SIZE = 380;
  const C = SIZE / 2;
  const R = 118;
  const MARK_R = 21;
  const CUT_R = R + 34;

  // 标记 i 的极角：自正上方起，沿屏幕顺时针递增 360/n 度。
  const markerAngle = (i: number) => (-90 + (360 * i) / n) * (Math.PI / 180);
  const polar = (angleRad: number, radius: number) => ({
    x: C + radius * Math.cos(angleRad),
    y: C + radius * Math.sin(angleRad),
  });
  // 切口 k（本帧编号系）位于标记 k-1 与 k 之间；用两单位向量之和取角平分
  // 线，天然正确处理切口 n 跨越 ±180° 接缝的情形。
  const cutAngle = (k: number) => {
    const a1 = markerAngle((k - 1 + n) % n);
    const a2 = markerAngle(k % n);
    return Math.atan2(Math.sin(a1) + Math.sin(a2), Math.cos(a1) + Math.cos(a2));
  };

  // 弧覆盖的显示下标（无论规范帧还是显示帧，弧上标记在帧序列中循环连续）。
  const hitIdx: number[] = [];
  if (hitMagnitudes) {
    tokens.forEach((t, i) => {
      if (hitMagnitudes.has(tokenMagnitude(t))) hitIdx.push(i);
    });
  }
  const arc = useMemo(() => {
    if (hitIdx.length === 0) return null;
    const inSet = new Set(hitIdx);
    const first = hitIdx.find((i) => !inSet.has((i - 1 + n) % n));
    if (first === undefined) return null;
    const len = hitIdx.length;
    if (len === n) return null; // 整环不会发生（两切口必须不同），双保险。
    // 槽 i 前一刻度在本帧编号系下为 i（i=0 时为 n）。
    const slotCut = (i: number) => (i === 0 ? n : i);
    const geomFrom = slotCut(first);
    const geomTo = slotCut((first + len) % n);
    const p1 = polar(cutAngle(geomFrom), R);
    const p2 = polar(cutAngle(geomTo), R);
    const extentDeg = (len * 360) / n;
    const largeArc = extentDeg > 180 ? 1 : 0;
    // 沿下标递增方向（屏幕顺时针）绘制，SVG sweep=1。
    return {
      path: `M ${p1.x.toFixed(2)} ${p1.y.toFixed(2)} A ${R} ${R} 0 ${largeArc} 1 ${p2.x.toFixed(2)} ${p2.y.toFixed(2)}`,
      geomFrom,
      geomTo,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hitIdx, n]);

  // 需要写出数字的刻度：规范帧写全部 n 个；显示帧只写弧两端，且写规范名。
  const labeledTicks: { k: number; name: number }[] = [];
  if (labelAllCuts) {
    for (let k = 1; k <= n; k += 1) labeledTicks.push({ k, name: k });
  } else if (arc && boundNames) {
    const nameFrom = swapped ? boundNames.b : boundNames.a;
    const nameTo = swapped ? boundNames.a : boundNames.b;
    labeledTicks.push({ k: arc.geomFrom, name: nameFrom });
    labeledTicks.push({ k: arc.geomTo, name: nameTo });
  }
  const boundNameSet = boundNames
    ? new Set<number>([boundNames.a, boundNames.b])
    : null;

  return (
    <div className={`state-row ring-row ${muted ? 'state-next' : ''}`}>
      <div className="state-caption muted">{caption}</div>
      <svg
        className="ring-svg"
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        width={SIZE}
        height={SIZE}
        role="img"
        aria-label="环形排列"
      >
        <circle cx={C} cy={C} r={R} className="ring-base" />
        {arc && <path d={arc.path} className="ring-arc" />}
        {labeledTicks.map(({ k, name }) => {
          const tickOuter = polar(cutAngle(k), R + 22);
          const tickInner = polar(cutAngle(k), R + 12);
          const label = polar(cutAngle(k), CUT_R + 12);
          const bound = boundNameSet?.has(name) ?? false;
          return (
            <g key={`cut-${k}`}>
              <line
                x1={tickInner.x}
                y1={tickInner.y}
                x2={tickOuter.x}
                y2={tickOuter.y}
                className={`ring-cut-tick ${bound ? 'ring-cut-bound' : ''}`}
              />
              <text
                x={label.x}
                y={label.y}
                className={`ring-cut ${bound ? 'ring-cut-bound' : ''}`}
                textAnchor="middle"
                dominantBaseline="central"
              >
                {name}
              </text>
            </g>
          );
        })}
        {tokens.map((t, i) => {
          const p = polar(markerAngle(i), R);
          const value = tokenToSigned(t);
          const hit = hitMagnitudes?.has(tokenMagnitude(t)) ?? false;
          return (
            <g key={i}>
              <circle
                cx={p.x}
                cy={p.y}
                r={MARK_R}
                className={[
                  'ring-marker',
                  value < 0 ? 'ring-marker-neg' : 'ring-marker-pos',
                  hit ? 'ring-marker-hit' : '',
                ].join(' ')}
              />
              <text
                x={p.x}
                y={p.y}
                className="ring-label"
                textAnchor="middle"
                dominantBaseline="central"
              >
                {value > 0 ? `+${value}` : value}
              </text>
            </g>
          );
        })}
      </svg>
      <div className="muted small ring-hint">
        {labelAllCuts
          ? '外圈数字为该规范表示的切口编号；粗弧与加粗刻度即所选切口对夹定的实际弧段。'
          : '本帧沿用深度 0 的环上坐标（仅旋转，未重新规范化）；仅弧两端刻度标出该步规范切口名。'}
      </div>
    </div>
  );
}

function StateRow({
  tokens,
  marks,
  caption,
  muted = false,
}: {
  tokens: Token[];
  marks: Set<number>;
  caption: string;
  muted?: boolean;
}) {
  return (
    <div className={`state-row ${muted ? 'state-next' : ''}`}>
      <div className="state-caption muted">{caption}</div>
      <div className="markers">
        {tokens.map((t, idx) => {
          const value = tokenToSigned(t);
          return (
            <span
              key={idx}
              className={[
                'marker',
                value < 0 ? 'marker-neg' : 'marker-pos',
                marks.has(idx) ? 'marker-hit' : '',
              ].join(' ')}
            >
              {value > 0 ? `+${value}` : value}
            </span>
          );
        })}
      </div>
    </div>
  );
}
