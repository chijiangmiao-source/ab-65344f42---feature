import { useCallback, useRef, useState } from 'react';
import {
  formatBigIntDecimal,
  tokenMagnitude,
  tokenToSigned,
  validatePermutation,
  type Token,
} from './lib/permutation';
import {
  fromDTO,
  solve,
  toDTO,
  type ArcCell,
  type AuditResult,
  type AuditResultDTO,
  type CircularAuditResult,
  type IntervalCell,
  type LinearAuditResult,
  type Topology,
} from './lib/solver';
import type { AuditRequest } from './audit.worker';

const EXAMPLES = [
  '1,-3,-2,4',
  '-1,-2,-3',
  '3,2,1',
  '-7,6,-5,4,-3,2,-1',
];

type SelectedCell =
  | { topology: 'linear'; depth: number; start: number; end: number }
  | { topology: 'circular'; depth: number; a: number; b: number };

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
  // 审计令牌：切换拓扑或发起新审计时作废尚未返回的旧结果。
  const auditTokenRef = useRef(0);

  // 切换拓扑：结果、矩阵选中与深度一律不沿用，必须在新拓扑下重新审计。
  const switchTopology = useCallback((next: Topology) => {
    auditTokenRef.current += 1;
    setTopology(next);
    setResult(null);
    setSelected(null);
    setActiveDepth(0);
    setErrors([]);
    setComputing(false);
  }, []);

  const runAudit = useCallback(() => {
    const { tokens, errors: validationErrors } = validatePermutation(input);
    // 无论合法与否，输入文本都原样保留；错误合并为一次反馈。
    setErrors(validationErrors);
    if (!tokens) {
      setResult(null);
      return;
    }

    const myToken = auditTokenRef.current + 1;
    auditTokenRef.current = myToken;
    setComputing(true);
    setResult(null);
    setSelected(null);
    setActiveDepth(0);

    const finish = (dto: AuditResultDTO) => {
      // 计算期间用户切换了拓扑或重新发起审计：丢弃过期结果。
      if (myToken !== auditTokenRef.current) return;
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
          规范方案与逐深度操作出现矩阵。支持线性与环状两种拓扑；
          所有计算均在本机完成，无后端、无网络请求。
        </p>
      </header>

      <section className="card" aria-label="排列输入">
        <div className="topology-switch" role="radiogroup" aria-label="拓扑模式">
          <span className="field-label as-label">拓扑</span>
          <div className="segmented">
            <button
              type="button"
              role="radio"
              aria-checked={topology === 'linear'}
              className={topology === 'linear' ? 'seg seg-on' : 'seg'}
              onClick={() => switchTopology('linear')}
            >
              线性
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={topology === 'circular'}
              className={topology === 'circular' ? 'seg seg-on' : 'seg'}
              onClick={() => switchTopology('circular')}
            >
              环状
            </button>
          </div>
          <span className="muted small topology-hint">
            {topology === 'linear'
              ? '位置 1 与 n 不相邻；倒位为闭区间 [i,j]。'
              : '位置 n 后接 1，无固定首标记与观察方向：循环旋转、整体反向并翻号视为同一状态；由两个切口确定一段弧，整环操作无效。'}
          </span>
        </div>

        <label className="field-label" htmlFor="perm-input">
          带符号排列（3 至 7 个标记，绝对值须恰好为 1 至 n 且互异）
        </label>
        <textarea
          id="perm-input"
          className="perm-input"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          rows={2}
          spellCheck={false}
          placeholder="例如：1,-3,-2,4"
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
          ? '线性倒位语义：选取闭区间 [i,j]，反转区间内标记次序并同时翻转每个符号；位置 1 与 n 不相邻。'
          : '环状倒位语义：两个不同切口确定一段弧，反转弧内标记次序并翻号；循环旋转与整体反向翻号为同一状态，整环操作无效。'}
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
  const { distance, totalPaths } = result;

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
          <div className="stat-value small-value">
            {result.topology === 'circular' ? '环状' : '线性'}
          </div>
          <div className="stat-label">审计拓扑</div>
        </div>
      </section>

      {result.topology === 'linear' ? (
        <LinearResult
          result={result}
          activeDepth={activeDepth}
          setActiveDepth={setActiveDepth}
          selected={selected}
          setSelected={setSelected}
        />
      ) : (
        <CircularResult
          result={result}
          activeDepth={activeDepth}
          setActiveDepth={setActiveDepth}
          selected={selected}
          setSelected={setSelected}
        />
      )}
    </>
  );
}

/* ============================== 线性 ============================== */

function LinearResult({
  result,
  activeDepth,
  setActiveDepth,
  selected,
  setSelected,
}: {
  result: LinearAuditResult;
  activeDepth: number;
  setActiveDepth: (d: number) => void;
  selected: SelectedCell | null;
  setSelected: (s: SelectedCell | null) => void;
}) {
  const { distance, canonical, matrix } = result;
  const linearSelected =
    selected?.topology === 'linear' ? selected : null;

  const currentStep =
    activeDepth < distance ? canonical.steps[activeDepth] : null;

  const jumpToDepth = useCallback(
    (cell: IntervalCell, depth: number) => {
      setActiveDepth(depth);
      setSelected({ topology: 'linear', depth, start: cell.start, end: cell.end });
    },
    [setActiveDepth, setSelected],
  );

  return (
    <>
      <section className="card" aria-label="规范方案轨迹">
        <h2>规范方案轨迹</h2>
        <p className="muted">
          {distance === 0
            ? '输入已是全正顺序，无需倒位。'
            : '在全部最短方案中，按每步 (起, 止) 下标对序列的字典序选出。可单步查看：'}
        </p>

        {distance > 0 && (
          <LinearTrajectory
            result={result}
            activeDepth={activeDepth}
            setActiveDepth={(d) => {
              // 手动浏览深度时清除矩阵选中，避免高亮仍指向旧深度。
              setSelected(null);
              setActiveDepth(d);
            }}
          />
        )}

        {currentStep && (
          <p className="step-hint">
            第 {activeDepth + 1} 步：对闭区间{' '}
            <strong>
              [{currentStep.start}, {currentStep.end}]
            </strong>{' '}
            执行倒位（反转次序并翻转符号）。
          </p>
        )}
      </section>

      {distance > 0 && (
        <section className="card" aria-label="深度区间矩阵">
          <h2>深度 × 区间出现矩阵</h2>
          <LinearLegend
            selected={linearSelected}
            canonicalAtDepth={
              linearSelected ? canonical.steps[linearSelected.depth] ?? null : null
            }
          />
          <div className="table-wrap">
            <table className="matrix">
              <thead>
                <tr>
                  <th className="corner">深度 ＼ 区间</th>
                  {matrix[0].intervals.map((cell) => (
                    <th key={`${cell.start}-${cell.end}`}>
                      {cell.start}-{cell.end}
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
                          linearSelected?.depth === layer.depth &&
                          linearSelected.start === cell.start &&
                          linearSelected.end === cell.end;
                        const dimmed =
                          linearSelected !== null && !isSelected && !isCanonical;
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
                              title={linearCellTitle(cell)}
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
            每格数字为：在该深度选择该区间的最短方案数量（bigint 精确计数）；
            每行之和等于方案总数。加粗描边格为规范方案在该深度的选择；
            点击任意格，轨迹视图联动跳转到对应深度。
          </p>
        </section>
      )}
    </>
  );
}

function linearCellTitle(cell: IntervalCell): string {
  const scope =
    cell.presence === 'all'
      ? '全部最短方案'
      : cell.presence === 'some'
        ? '部分最短方案'
        : '任何最短方案中均未出现';
  return `区间 [${cell.start}, ${cell.end}]：${scope}，出现于 ${cell.pathCount} 个最短方案`;
}

function LinearLegend({
  selected,
  canonicalAtDepth,
}: {
  selected: { topology: 'linear'; depth: number; start: number; end: number } | null;
  canonicalAtDepth: { start: number; end: number } | null;
}) {
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
      {selected && (
        <span className="legend-note" role="status">
          已选第 {selected.depth + 1} 步区间 [{selected.start}, {selected.end}]
          {canonicalAtDepth &&
          canonicalAtDepth.start === selected.start &&
          canonicalAtDepth.end === selected.end
            ? '，正是规范轨迹上的倒位。'
            : '，该倒位不在规范轨迹上（规范选择见描边格）。'}
        </span>
      )}
    </div>
  );
}

function LinearTrajectory({
  result,
  activeDepth,
  setActiveDepth,
}: {
  result: LinearAuditResult;
  activeDepth: number;
  setActiveDepth: (d: number) => void;
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
    <div>
      <Stepper
        activeDepth={activeDepth}
        distance={distance}
        setActiveDepth={setActiveDepth}
      />

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

      <Scrubber
        activeDepth={activeDepth}
        distance={distance}
        setActiveDepth={setActiveDepth}
      />
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

/* ============================== 环状 ============================== */

function CircularResult({
  result,
  activeDepth,
  setActiveDepth,
  selected,
  setSelected,
}: {
  result: CircularAuditResult;
  activeDepth: number;
  setActiveDepth: (d: number) => void;
  selected: SelectedCell | null;
  setSelected: (s: SelectedCell | null) => void;
}) {
  const { distance, canonical, matrix, repMapping, initial } = result;
  const circSelected =
    selected?.topology === 'circular' ? selected : null;

  const currentStep = activeDepth < distance ? canonical.steps[activeDepth] : null;
  // 点击矩阵格时高亮所选弧；逐步浏览时高亮该深度规范步骤的实际弧段。
  const shownArc =
    circSelected && circSelected.depth === activeDepth
      ? { a: circSelected.a, b: circSelected.b }
      : currentStep;
  const arcEqualsStep =
    shownArc !== null &&
    currentStep !== null &&
    shownArc.a === currentStep.a &&
    shownArc.b === currentStep.b;

  const jumpToDepth = useCallback(
    (cell: ArcCell, depth: number) => {
      setActiveDepth(depth);
      setSelected({ topology: 'circular', depth, a: cell.a, b: cell.b });
    },
    [setActiveDepth, setSelected],
  );

  const repText = `[${initial.map((t) => tokenToSigned(t)).join(', ')}]`;

  return (
    <>
      <section className="card" aria-label="环状规范化说明">
        <h2>环状规范表示</h2>
        <p className="muted" style={{ margin: 0 }}>
          环上无固定首标记与观察链方向，循环旋转与整体反向并翻号视为同一状态。
          当前输入的规范代表元为 <strong className="mono">{repText}</strong>
          {repMapping.flipped || repMapping.rotation !== 0
            ? `（由原序列${repMapping.flipped ? '整体反向并翻号后' : ''}旋转 ${repMapping.rotation} 步得到）`
            : '（原序列本身即最小表示）'}
          ；目标为正向环序 <strong className="mono">[1, 2, …, {result.n}]</strong>
          （其任意旋转 / 反向翻号亦为目标）。
        </p>
      </section>

      <section className="card" aria-label="规范方案轨迹">
        <h2>规范方案轨迹</h2>
        <p className="muted">
          {distance === 0
            ? '输入与正向环序属于同一环状状态，无需倒位。'
            : '在全部最短方案中按每步切口对 (a, b) 的字典序选出；每步名称取自当前规范表示，逐步浏览时按标记绝对值跟踪，不会因重新规范化跳错标记。'}
        </p>

        {distance > 0 && (
          <div>
            <Stepper
              activeDepth={activeDepth}
              distance={distance}
              setActiveDepth={(d) => {
                setSelected(null);
                setActiveDepth(d);
              }}
            />
            <CircularTrajectory
              result={result}
              activeDepth={activeDepth}
              arc={shownArc}
              arcIsCanonical={arcEqualsStep}
            />
            <Scrubber
              activeDepth={activeDepth}
              distance={distance}
              setActiveDepth={(d) => {
                setSelected(null);
                setActiveDepth(d);
              }}
            />
          </div>
        )}

        {shownArc && (
          <p className="step-hint">
            第 {activeDepth + 1} 步：在切口 <strong>{shownArc.a}</strong> 与切口{' '}
            <strong>{shownArc.b}</strong> 之间的弧段（位置 {shownArc.a + 1} …{' '}
            {shownArc.b}，共 {shownArc.b - shownArc.a} 个标记）执行倒位
            {circSelected && circSelected.depth === activeDepth && !arcEqualsStep
              ? '（矩阵选中弧；规范轨迹此步的选择见描边格）'
              : ''}
            。互补弧（另一段）给出等价状态，不另计一条边。
          </p>
        )}
      </section>

      {distance > 0 && (
        <section className="card" aria-label="深度切口对矩阵">
          <h2>深度 × 切口对出现矩阵</h2>
          <CircularLegend
            selected={circSelected}
            canonicalAtDepth={
              circSelected ? canonical.steps[circSelected.depth] ?? null : null
            }
          />
          <div className="table-wrap">
            <table className="matrix">
              <thead>
                <tr>
                  <th className="corner">深度 ＼ 切口对</th>
                  {matrix[0].arcs.map((cell) => (
                    <th key={`${cell.a}-${cell.b}`}>
                      {cell.a},{cell.b}
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
                      {layer.arcs.map((cell) => {
                        const isCanonical = canon.a === cell.a && canon.b === cell.b;
                        const isSelected =
                          circSelected?.depth === layer.depth &&
                          circSelected.a === cell.a &&
                          circSelected.b === cell.b;
                        const dimmed = circSelected !== null && !isSelected && !isCanonical;
                        return (
                          <td key={`${cell.a}-${cell.b}`}>
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
                              title={arcCellTitle(cell)}
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
            切口 k 位于位置 k 与 k+1 之间（切口 {result.n} 位于 {result.n} 与 1 之间）；
            每格数字为该深度选择该切口对的最短方案数量。同一状态对之间由互补弧或
            不同表示产生的重复边只计一次，并以当前规范表示下字典序最小的切口对命名；
            每行之和等于方案总数。点击任意格，环形轨迹联动高亮实际弧段。
          </p>
        </section>
      )}
    </>
  );
}

function arcCellTitle(cell: ArcCell): string {
  const scope =
    cell.presence === 'all'
      ? '全部最短方案'
      : cell.presence === 'some'
        ? '部分最短方案'
        : '任何最短方案中均未出现';
  return `切口对 (${cell.a}, ${cell.b})，弧段位置 ${cell.a + 1}…${cell.b}：${scope}，出现于 ${cell.pathCount} 个最短方案（重复边只计一次）`;
}

function CircularLegend({
  selected,
  canonicalAtDepth,
}: {
  selected: { topology: 'circular'; depth: number; a: number; b: number } | null;
  canonicalAtDepth: { a: number; b: number } | null;
}) {
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
      {selected && (
        <span className="legend-note" role="status">
          已选第 {selected.depth + 1} 步切口对 ({selected.a}, {selected.b})
          {canonicalAtDepth &&
          canonicalAtDepth.a === selected.a &&
          canonicalAtDepth.b === selected.b
            ? '，正是规范轨迹上的倒位。'
            : '，该弧不在规范轨迹上（规范选择见描边格）。'}
        </span>
      )}
    </div>
  );
}

function CircularTrajectory({
  result,
  activeDepth,
  arc,
  arcIsCanonical,
}: {
  result: CircularAuditResult;
  activeDepth: number;
  arc: { a: number; b: number } | null;
  arcIsCanonical: boolean;
}) {
  const { canonical, distance, n } = result;
  const current = canonical.states[activeDepth];
  const next = activeDepth < distance ? canonical.states[activeDepth + 1] : null;

  // 按标记绝对值跟踪弧段：执行后即使代表元被重新规范化，高亮也不跳错标记。
  const hitMagnitudes = new Set<number>();
  if (arc) {
    // 切口 a 与切口 b 之间的非跨首尾弧覆盖位置 a+1..b（0 基 [a, b-1]）。
    for (let k = arc.a; k <= arc.b - 1; k += 1) {
      hitMagnitudes.add(tokenMagnitude(current[k]));
    }
  }

  return (
    <div className="ring-states">
      <div className="ring-block">
        <div className="state-caption muted">深度 {activeDepth}（执行前，规范表示）</div>
        <Ring
          n={n}
          tokens={current}
          arc={arc}
          hitMagnitudes={hitMagnitudes}
          showCuts
          highlightKind={arcIsCanonical ? 'canonical' : 'selected'}
        />
      </div>
      {arc && next && (
        <>
          <div className="arrow arrow-vert" aria-hidden="true">
            → ({arc.a},{arc.b})
          </div>
          <div className="ring-block">
            <div className="state-caption muted">
              深度 {activeDepth + 1}（执行后，已重新规范化）
            </div>
            <Ring
              n={n}
              tokens={next}
              arc={null}
              hitMagnitudes={hitMagnitudes}
              showCuts={false}
              highlightKind="canonical"
              muted
            />
          </div>
        </>
      )}
    </div>
  );
}

/** 环形轨迹 SVG：节点 k（1 基）均匀排布，切口 k 位于节点 k 与 k+1 之间。 */
function Ring({
  n,
  tokens,
  arc,
  hitMagnitudes,
  showCuts,
  highlightKind,
  muted = false,
}: {
  n: number;
  tokens: Token[];
  arc: { a: number; b: number } | null;
  hitMagnitudes: Set<number>;
  showCuts: boolean;
  highlightKind: 'canonical' | 'selected';
  muted?: boolean;
}) {
  const SIZE = 340;
  const C = SIZE / 2;
  const R_NODE = 118;
  const R_ARC = 148;
  const R_CUT_OUTER = 148;
  const R_CUT_INNER = 130;
  const R_LABEL = 162;

  const step = 360 / n;
  // 节点 1 置于正上方；角度按数学约定（屏幕上顺时针）。
  const nodeAngle = (k1: number) => -90 + (k1 - 1) * step;
  // 切口 k 位于节点 k 与 k+1 之间；切口 n 位于节点 n 与节点 1 之间。
  // 角度不取模，保持单调递增，以便 SVG 弧的 sweep / large-arc 标志直接对应
  // 从切口 a 顺时针到切口 b（经过节点 a+1..b）的那段弧。
  const gapAngle = (k: number) => -90 + (k - 0.5) * step;
  const xy = (angleDeg: number, r: number) => {
    const rad = (angleDeg * Math.PI) / 180;
    return { x: C + r * Math.cos(rad), y: C + r * Math.sin(rad) };
  };

  let arcPath: string | null = null;
  if (arc) {
    const a0 = gapAngle(arc.a);
    const a1 = gapAngle(arc.b);
    const p0 = xy(a0, R_ARC);
    const p1 = xy(a1, R_ARC);
    const span = (arc.b - arc.a) * step;
    const largeArc = span > 180 ? 1 : 0;
    arcPath = `M ${p0.x} ${p0.y} A ${R_ARC} ${R_ARC} 0 ${largeArc} 1 ${p1.x} ${p1.y}`;
  }

  return (
    <svg
      className={`ring-svg ${muted ? 'ring-muted' : ''}`}
      width={SIZE}
      height={SIZE}
      viewBox={`0 0 ${SIZE} ${SIZE}`}
      role="img"
      aria-label="环形排列轨迹"
    >
      <circle className="ring-base" cx={C} cy={C} r={R_NODE} />
      {arcPath && (
        <path
          className={highlightKind === 'selected' ? 'ring-arc ring-arc-selected' : 'ring-arc'}
          d={arcPath}
        />
      )}
      {showCuts &&
        arc &&
        [arc.a, arc.b].map((k) => {
          const pOut = xy(gapAngle(k), R_CUT_OUTER);
          const pIn = xy(gapAngle(k), R_CUT_INNER);
          const pLabel = xy(gapAngle(k), R_LABEL);
          return (
            <g key={`cut-${k}`}>
              <line
                className="ring-cut"
                x1={pIn.x}
                y1={pIn.y}
                x2={pOut.x}
                y2={pOut.y}
              />
              <text
                className="ring-cut-label"
                x={pLabel.x}
                y={pLabel.y}
                textAnchor="middle"
                dominantBaseline="central"
              >
                {k}
              </text>
            </g>
          );
        })}
      {tokens.map((t, idx) => {
        const k1 = idx + 1;
        const p = xy(nodeAngle(k1), R_NODE);
        const value = tokenToSigned(t);
        const hit = hitMagnitudes.has(tokenMagnitude(t));
        return (
          <g key={`node-${k1}`} transform={`translate(${p.x}, ${p.y})`}>
            <circle
              className={[
                'ring-node',
                value < 0 ? 'ring-node-neg' : 'ring-node-pos',
                hit ? 'ring-node-hit' : '',
              ].join(' ')}
              r={19}
            />
            <text
              className="ring-node-label"
              textAnchor="middle"
              dominantBaseline="central"
            >
              {value > 0 ? value : `−${-value}`}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

/* ============================== 共用控件 ============================== */

function Stepper({
  activeDepth,
  distance,
  setActiveDepth,
}: {
  activeDepth: number;
  distance: number;
  setActiveDepth: (d: number) => void;
}) {
  return (
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
  );
}

function Scrubber({
  activeDepth,
  distance,
  setActiveDepth,
}: {
  activeDepth: number;
  distance: number;
  setActiveDepth: (d: number) => void;
}) {
  return (
    <input
      className="scrub"
      type="range"
      min={0}
      max={distance}
      value={activeDepth}
      onChange={(e) => setActiveDepth(Number(e.target.value))}
      aria-label="选择查看的深度"
    />
  );
}
