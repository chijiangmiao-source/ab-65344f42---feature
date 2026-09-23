/**
 * 带符号排列的倒位（reversal）最短方案审计，支持两种拓扑：
 *
 * - linear（线性，原有语义保持不变）：
 *   状态直接用压缩整数表示（见 permutation.ts 的 encodeState，每 4 位 nibble
 *   存 token+1）。倒位邻居完全用位运算枚举：在区间 [i,j] 上，新状态第 k 位的
 *   nibble 为旧状态第 i+j-k 位 nibble 先翻转符号（token ^ 1）再加 1。
 *
 * - circular（环状）：
 *   环上没有固定首标记 / 观察链方向，同一物理排列的任意循环旋转（n 种）与
 *   “整体反向并翻号”（negate+reverse，再 ×n 种旋转）视为同一状态，共 2n 个
 *   表示。每个状态取该等价类中压缩码最小的表示作为规范表示。
 *   切口 k 位于位置 k 与 k+1 之间（切口 n 位于 n 与 1 之间）；一对不同切口
 *   (a,b)（a<b）把环切成两段弧，倒位其中任意一段得到的后继状态等价（另一段
 *   是互补弧，其结果等于本段结果整体反向翻号后再旋转），故一对切口只产生
 *   一条边；整环（同一切口 / 不下第二刀）不是合法操作。同一状态对之间由
 *   互补弧或不同表示产生的重复边只计一次，并以当前规范表示下字典序最小的
 *   切口对命名。
 *
 * n<=7 时线性状态至多 2^n·n! ≈ 645120（环状商图再除以至多 2n），浏览器内
 * 可即时完成，所有结果都是精确的：
 *   - 最短步数；
 *   - 方案总数（bigint 任意精度累加，按十进制展示）；
 *   - 规范方案：全部最短方案中按“每步操作对”字典序最小者；
 *   - 深度×操作矩阵：线性按闭区间聚合，环状按切口对聚合。
 */

import { decodeState, encodeState, type Token } from './permutation';

export type Topology = 'linear' | 'circular';

/** 线性模式的一次倒位：1 基闭区间 [start,end]；反转次序并翻转符号。 */
export interface InversionStep {
  start: number;
  end: number;
}

/** 环状模式的一次倒位：切口 a 与切口 b（均 1 基，a<b）之间的弧段（位置 a..b-1）。 */
export interface ArcStep {
  a: number;
  b: number;
}

export type CellPresence = 'all' | 'some' | 'none';

export interface IntervalCell {
  start: number;
  end: number;
  /** 在深度 depth 执行该倒位的最短方案数量（bigint，精确） */
  pathCount: bigint;
  presence: CellPresence;
}

export interface ArcCell {
  a: number;
  b: number;
  /** 在深度 depth 选择该切口对的最短方案数量（bigint，精确；重复边只计一次） */
  pathCount: bigint;
  presence: CellPresence;
}

interface AuditResultBase {
  n: number;
  /** 该模式下展示 / 审计所基于的初始表示（环状为规范化代表元） */
  initial: Token[];
  /** 最少倒位步数 */
  distance: number;
  /** 全部最短方案总数（任意精度） */
  totalPaths: bigint;
}

export interface LinearAuditResult extends AuditResultBase {
  topology: 'linear';
  /** 规范方案：全最短方案中每步 (start,end) 序列字典序最小者 */
  canonical: {
    steps: InversionStep[];
    states: Token[][];
  };
  /**
   * 深度×区间矩阵。matrix[d] 给出深度 d（第 d+1 步）各区间的出现统计，
   * 区间按 (start,end) 字典序排列；depth 0 对应初始态的第一步。
   */
  matrix: {
    depth: number;
    intervals: IntervalCell[];
  }[];
}

export interface CircularAuditResult extends AuditResultBase {
  topology: 'circular';
  /** 原始输入与规范代表元之间的关系：rep[k] = rotate^r(flipped ? negRev(input) : input)[k]。 */
  repMapping: {
    rotation: number;
    flipped: boolean;
  };
  /** 规范方案：每一步都以“当前状态规范表示”下字典序最小的切口对命名。 */
  canonical: {
    steps: ArcStep[];
    states: Token[][];
  };
  /** 深度×切口对矩阵，切口对按 (a,b) 字典序排列。 */
  matrix: {
    depth: number;
    arcs: ArcCell[];
  }[];
}

export type AuditResult = LinearAuditResult | CircularAuditResult;

/* ==================================================================== *
 * 压缩状态上的位运算原语（nibble = token+1，每标记占 4 位）
 * ==================================================================== */

/** 在压缩状态上对闭区间 [i,j]（0 基，含端点）做倒位，返回新压缩码。 */
function invertIntervalCode(code: number, i: number, j: number): number {
  let nextCode = code;
  let mask = 0;
  for (let k = i; k <= j; k += 1) mask |= 0x0f << (4 * k);
  nextCode &= ~mask;
  for (let k = i; k <= j; k += 1) {
    // 存储 nibble = token+1；翻转后的存储值为 ((token ^ 1) + 1)。
    const stored = (code >>> (4 * (i + j - k))) & 0x0f;
    const flipped = ((stored - 1) ^ 1) + 1;
    nextCode |= flipped << (4 * k);
  }
  return nextCode;
}

/** 在压缩状态 code 上枚举全部线性倒位邻居，按 (i,j) 字典序回调，零数组分配。 */
function eachNeighbor(
  code: number,
  n: number,
  cb: (nextCode: number, start: number, end: number) => void,
): void {
  for (let i = 0; i < n; i += 1) {
    for (let j = i; j < n; j += 1) {
      cb(invertIntervalCode(code, i, j), i + 1, j + 1);
    }
  }
}

function identityCode(n: number): number {
  let code = 0;
  for (let k = 0; k < n; k += 1) code |= (2 * k + 1) << (4 * k);
  return code;
}

/* ==================================================================== *
 * 环状拓扑：规范表示（循环旋转 + 整体反向翻号）
 * ==================================================================== */

interface CircularContext {
  n: number;
  mask: number;
  /** nibble 翻转查表：stored value v -> 符号翻转后的 stored value */
  flipNib: number[];
}

function makeCircularContext(n: number): CircularContext {
  const flipNib = new Array<number>(16).fill(0);
  for (let v = 0; v < 16; v += 1) flipNib[v] = ((v - 1) ^ 1) + 1;
  return { n, mask: (1 << (4 * n)) - 1, flipNib };
}

/** 环上向左旋转一个位置（显示位 k 取原位 k+1 的标记），纯位运算。 */
function rotateLeft(ctx: CircularContext, code: number): number {
  const { n, mask } = ctx;
  return ((code >>> 4) | (code << (4 * (n - 1)))) & mask;
}

/** 整体反向并翻号（negate+reverse）的压缩码：逐 nibble 翻转后镜像次序。 */
function flipWholeCode(ctx: CircularContext, code: number): number {
  const { n, flipNib } = ctx;
  let out = 0;
  for (let k = 0; k < n; k += 1) {
    const nib = (code >>> (4 * k)) & 0x0f;
    out |= flipNib[nib] << (4 * (n - 1 - k));
  }
  return out;
}

interface Canonical {
  code: number;
  /** 达到最小表示所用的旋转步数 r：rep[k] = base[(k+r) mod n] */
  rotation: number;
  /** 达到最小表示前是否先做了整体反向翻号 */
  flipped: boolean;
}

/**
 * 返回压缩码所在环等价类的规范表示：在原序列与“整体反向翻号”序列的各 n 个
 * 循环旋转中取压缩码最小者（按“先原向后反向、旋转步数递增”的次序决胜，
 * 保证确定性）。
 */
function canonicalize(ctx: CircularContext, code: number): Canonical {

  let best = code;
  let rotation = 0;
  let flipped = false;

  let cur = code;
  for (let r = 1; r < ctx.n; r += 1) {
    cur = rotateLeft(ctx, cur);
    if (cur < best) {
      best = cur;
      rotation = r;
    }
  }

  const reversed = flipWholeCode(ctx, code);
  cur = reversed;
  if (cur < best) {
    best = cur;
    rotation = 0;
    flipped = true;
  }
  for (let r = 1; r < ctx.n; r += 1) {
    cur = rotateLeft(ctx, cur);
    if (cur < best) {
      best = cur;
      rotation = r;
      flipped = true;
    }
  }

  return { code: best, rotation, flipped };
}

/**
 * 枚举环状规范状态 u 的全部商图邻居（已规范化、已去重）。
 * 切口对 (a,b)（1 基，a<b）：切口 k 位于位置 k 与 k+1 之间，故从切口 a
 * 顺时针到切口 b 的非跨首尾弧覆盖位置 a+1..b（0 基 [a, b-1]），另一段
 * （跨首尾）互补弧给出等价后继。对同一后继 v，仅回调第一次（即字典序
 * 最小的）切口对——互补弧 / 不同表示造成的重复边在此合并。
 */
function eachCircularEdge(
  ctx: CircularContext,
  u: number,
  cb: (v: number, a: number, b: number) => void,
): void {
  const seen = new Set<number>();
  for (let c1 = 0; c1 < ctx.n - 1; c1 += 1) {
    for (let c2 = c1 + 1; c2 < ctx.n; c2 += 1) {
      // 切口 c1+1 与 c2+1 之间的非跨首尾弧 = 闭区间 [c1+1, c2]（0 基）。
      const raw = invertIntervalCode(u, c1 + 1, c2);
      const v = canonicalize(ctx, raw).code;
      if (seen.has(v)) continue;
      seen.add(v);
      cb(v, c1 + 1, c2 + 1);
    }
  }
}

/* ==================================================================== *
 * 线性求解（原有算法，语义逐位保持）
 * ==================================================================== */

function solveLinear(initial: Token[]): LinearAuditResult {
  const n = initial.length;
  const goalCode = identityCode(n);
  const startCode = encodeState(initial);

  if (startCode === goalCode) {
    // 全正顺序：距离 0、方案 1（空序列），矩阵为空。
    return {
      topology: 'linear',
      n,
      initial,
      distance: 0,
      totalPaths: 1n,
      canonical: { steps: [], states: [initial.slice()] },
      matrix: [],
    };
  }

  /* ------------------------------------------------------------------ *
   * 1) 前向 BFS：distF（初始态 -> 各态）与规范父边。
   *    邻居按 (start,end) 字典序枚举，首次到达的父边即字典序最早者，
   *    沿它回溯得到规范方案。
   * ------------------------------------------------------------------ */
  const distF = new Map<number, number>();
  const parent = new Map<number, { code: number; start: number; end: number }>();
  {
    const queue: number[] = [startCode];
    distF.set(startCode, 0);
    let head = 0;
    while (head < queue.length) {
      const code = queue[head++];
      const d = distF.get(code)!;
      if (code === goalCode) break; // 队列按层推进，到达目标即最短层
      eachNeighbor(code, n, (nextCode, start, end) => {
        if (!distF.has(nextCode)) {
          distF.set(nextCode, d + 1);
          parent.set(nextCode, { code, start, end });
          queue.push(nextCode);
        }
      });
    }
  }

  const distance = distF.get(goalCode)!;

  /* ------------------------------------------------------------------ *
   * 2) 反向 BFS（倒位自逆，邻居枚举相同），只保留位于某条最短路径上
   *    的状态（distF <= distance）。分层汇总 waysToGoal：
   *    v 到目标的最短路径条数。
   * ------------------------------------------------------------------ */
  const distR = new Map<number, number>();
  const waysToGoal = new Map<number, bigint>();
  const layers: number[][] = [];
  {
    distR.set(goalCode, 0);
    waysToGoal.set(goalCode, 1n);
    layers.push([goalCode]);
    for (let d = 0; d < distance; d += 1) {
      const nextLayer: number[] = [];
      for (const code of layers[d]) {
        eachNeighbor(code, n, (nextCode) => {
          if (distR.has(nextCode)) return;
          const fd = distF.get(nextCode);
          if (fd === undefined || fd > distance) return;
          distR.set(nextCode, d + 1);
          waysToGoal.set(nextCode, 0n);
          nextLayer.push(nextCode);
        });
      }
      layers.push(nextLayer);
    }
    // layers[d] 中状态到目标的距离为 d，其最短后继位于 layers[d-1]。
    for (let d = 1; d <= distance; d += 1) {
      for (const code of layers[d]) {
        let ways = 0n;
        eachNeighbor(code, n, (nextCode) => {
          if (distR.get(nextCode) === d - 1) {
            ways += waysToGoal.get(nextCode)!;
          }
        });
        waysToGoal.set(code, ways);
      }
    }
  }

  const totalPaths = waysToGoal.get(startCode)!;

  /* ------------------------------------------------------------------ *
   * 3) 逐层枚举最短边 (u,v)：distF[u]=d、distR[v]=distance-d-1。
   *    边方案数 = waysFromStart(u) * waysToGoal(v)，按区间聚合到矩阵格；
   *    waysFromStart 随层滚动。
   * ------------------------------------------------------------------ */
  const matrix: LinearAuditResult['matrix'] = [];
  let waysFrom = new Map<number, bigint>([[startCode, 1n]]);

  // 全部区间按 (start,end) 字典序预登记，任何最短方案都没用到的保持 none。
  const allIntervals: { start: number; end: number }[] = [];
  for (let i = 0; i < n; i += 1) {
    for (let j = i; j < n; j += 1) {
      allIntervals.push({ start: i + 1, end: j + 1 });
    }
  }

  for (let d = 0; d < distance; d += 1) {
    const counts = new Map<string, bigint>();
    for (const { start, end } of allIntervals) {
      counts.set(`${start}:${end}`, 0n);
    }
    const nextWaysFrom = new Map<number, bigint>();

    for (const [uCode, waysU] of waysFrom) {
      eachNeighbor(uCode, n, (nextCode, start, end) => {
        if (distF.get(nextCode) !== d + 1) return;
        if (distR.get(nextCode) !== distance - d - 1) return;
        const key = `${start}:${end}`;
        counts.set(key, counts.get(key)! + waysU * waysToGoal.get(nextCode)!);
        nextWaysFrom.set(nextCode, (nextWaysFrom.get(nextCode) ?? 0n) + waysU);
      });
    }

    const intervals: IntervalCell[] = allIntervals.map(({ start, end }) => {
      const pathCount = counts.get(`${start}:${end}`)!;
      const presence: CellPresence =
        pathCount === totalPaths ? 'all' : pathCount === 0n ? 'none' : 'some';
      return { start, end, pathCount, presence };
    });
    matrix.push({ depth: d, intervals });
    waysFrom = nextWaysFrom;
  }

  /* ------------------------------------------------------------------ *
   * 4) 规范路径：沿前向 BFS 的最早父边回溯到初始态，再反序。
   * ------------------------------------------------------------------ */
  const steps: InversionStep[] = [];
  const statesReversed: Token[][] = [decodeState(goalCode, n)];
  let cursor = goalCode;
  while (cursor !== startCode) {
    const p = parent.get(cursor)!;
    steps.push({ start: p.start, end: p.end });
    statesReversed.push(decodeState(p.code, n));
    cursor = p.code;
  }
  steps.reverse();
  statesReversed.reverse();

  return {
    topology: 'linear',
    n,
    initial,
    distance,
    totalPaths,
    canonical: { steps, states: statesReversed },
    matrix,
  };
}

/* ==================================================================== *
 * 环状求解：在“旋转 + 整体反向翻号”商图上做同样的精确枚举
 * ==================================================================== */

function solveCircular(initial: Token[]): CircularAuditResult {
  const n = initial.length;
  const ctx = makeCircularContext(n);
  const startCanon = canonicalize(ctx, encodeState(initial));
  const goalCanon = canonicalize(ctx, identityCode(n));
  const startCode = startCanon.code;
  const goalCode = goalCanon.code;
  const initialRep = decodeState(startCode, n);

  if (startCode === goalCode) {
    return {
      topology: 'circular',
      n,
      initial: initialRep,
      distance: 0,
      totalPaths: 1n,
      repMapping: { rotation: startCanon.rotation, flipped: startCanon.flipped },
      canonical: { steps: [], states: [initialRep.slice()] },
      matrix: [],
    };
  }

  /* 1) 前向 BFS（商图）：邻居已按切口对字典序去重，首次父边即规范边。 */
  const distF = new Map<number, number>();
  const parent = new Map<number, { code: number; a: number; b: number }>();
  {
    const queue: number[] = [startCode];
    distF.set(startCode, 0);
    let head = 0;
    while (head < queue.length) {
      const code = queue[head++];
      const d = distF.get(code)!;
      if (code === goalCode) break;
      eachCircularEdge(ctx, code, (v, a, b) => {
        if (!distF.has(v)) {
          distF.set(v, d + 1);
          parent.set(v, { code, a, b });
          queue.push(v);
        }
      });
    }
  }

  const distance = distF.get(goalCode)!;

  /* 2) 反向 BFS + 分层 DP：每条去重后的边只计一次。 */
  const distR = new Map<number, number>();
  const waysToGoal = new Map<number, bigint>();
  const layers: number[][] = [];
  {
    distR.set(goalCode, 0);
    waysToGoal.set(goalCode, 1n);
    layers.push([goalCode]);
    for (let d = 0; d < distance; d += 1) {
      const nextLayer: number[] = [];
      for (const code of layers[d]) {
        eachCircularEdge(ctx, code, (v) => {
          if (distR.has(v)) return;
          const fd = distF.get(v);
          if (fd === undefined || fd > distance) return;
          distR.set(v, d + 1);
          waysToGoal.set(v, 0n);
          nextLayer.push(v);
        });
      }
      layers.push(nextLayer);
    }
    for (let d = 1; d <= distance; d += 1) {
      for (const code of layers[d]) {
        let ways = 0n;
        eachCircularEdge(ctx, code, (v) => {
          if (distR.get(v) === d - 1) {
            ways += waysToGoal.get(v)!;
          }
        });
        waysToGoal.set(code, ways);
      }
    }
  }

  const totalPaths = waysToGoal.get(startCode)!;

  /* 3) 逐层最短边枚举，按切口对名聚合；同一状态对的重复边已在枚举处合并。 */
  const matrix: CircularAuditResult['matrix'] = [];
  let waysFrom = new Map<number, bigint>([[startCode, 1n]]);

  const allArcs: { a: number; b: number }[] = [];
  for (let a = 1; a < n; a += 1) {
    for (let b = a + 1; b <= n; b += 1) {
      allArcs.push({ a, b });
    }
  }

  for (let d = 0; d < distance; d += 1) {
    const counts = new Map<string, bigint>();
    for (const { a, b } of allArcs) counts.set(`${a}:${b}`, 0n);
    const nextWaysFrom = new Map<number, bigint>();

    for (const [uCode, waysU] of waysFrom) {
      eachCircularEdge(ctx, uCode, (v, a, b) => {
        if (distF.get(v) !== d + 1) return;
        if (distR.get(v) !== distance - d - 1) return;
        const key = `${a}:${b}`;
        counts.set(key, counts.get(key)! + waysU * waysToGoal.get(v)!);
        nextWaysFrom.set(v, (nextWaysFrom.get(v) ?? 0n) + waysU);
      });
    }

    const arcs: ArcCell[] = allArcs.map(({ a, b }) => {
      const pathCount = counts.get(`${a}:${b}`)!;
      const presence: CellPresence =
        pathCount === totalPaths ? 'all' : pathCount === 0n ? 'none' : 'some';
      return { a, b, pathCount, presence };
    });
    matrix.push({ depth: d, arcs });
    waysFrom = nextWaysFrom;
  }

  /* 4) 规范路径回溯；每个状态本身就是规范表示，逐步浏览无需重新规范化。 */
  const steps: ArcStep[] = [];
  const statesReversed: Token[][] = [decodeState(goalCode, n)];
  let cursor = goalCode;
  while (cursor !== startCode) {
    const p = parent.get(cursor)!;
    steps.push({ a: p.a, b: p.b });
    statesReversed.push(decodeState(p.code, n));
    cursor = p.code;
  }
  steps.reverse();
  statesReversed.reverse();

  return {
    topology: 'circular',
    n,
    initial: initialRep,
    distance,
    totalPaths,
    repMapping: { rotation: startCanon.rotation, flipped: startCanon.flipped },
    canonical: { steps, states: statesReversed },
    matrix,
  };
}

export function solve(initial: Token[], topology?: 'linear'): LinearAuditResult;
export function solve(initial: Token[], topology: 'circular'): CircularAuditResult;
export function solve(initial: Token[], topology: Topology): AuditResult;
export function solve(initial: Token[], topology: Topology = 'linear'): AuditResult {
  return topology === 'circular' ? solveCircular(initial) : solveLinear(initial);
}

/* ==================================================================== *
 * Worker 传输 DTO：bigint 统一转十进制字符串
 * ==================================================================== */

export interface AuditResultDTO {
  topology: Topology;
  n: number;
  initial: Token[];
  distance: number;
  totalPaths: string;
  repMapping?: { rotation: number; flipped: boolean };
  canonical: {
    steps: Array<InversionStep | ArcStep>;
    states: Token[][];
  };
  matrix: {
    depth: number;
    intervals?: {
      start: number;
      end: number;
      pathCount: string;
      presence: CellPresence;
    }[];
    arcs?: {
      a: number;
      b: number;
      pathCount: string;
      presence: CellPresence;
    }[];
  }[];
}

export function toDTO(result: AuditResult): AuditResultDTO {
  if (result.topology === 'circular') {
    return {
      topology: 'circular',
      n: result.n,
      initial: result.initial,
      distance: result.distance,
      totalPaths: result.totalPaths.toString(),
      repMapping: result.repMapping,
      canonical: result.canonical,
      matrix: result.matrix.map((layer) => ({
        depth: layer.depth,
        arcs: layer.arcs.map((cell) => ({
          a: cell.a,
          b: cell.b,
          pathCount: cell.pathCount.toString(),
          presence: cell.presence,
        })),
      })),
    };
  }
  return {
    topology: 'linear',
    n: result.n,
    initial: result.initial,
    distance: result.distance,
    totalPaths: result.totalPaths.toString(),
    canonical: result.canonical,
    matrix: result.matrix.map((layer) => ({
      depth: layer.depth,
      intervals: layer.intervals.map((cell) => ({
        start: cell.start,
        end: cell.end,
        pathCount: cell.pathCount.toString(),
        presence: cell.presence,
      })),
    })),
  };
}

export function fromDTO(dto: AuditResultDTO): AuditResult {
  if (dto.topology === 'circular') {
    return {
      topology: 'circular',
      n: dto.n,
      initial: dto.initial,
      distance: dto.distance,
      totalPaths: BigInt(dto.totalPaths),
      repMapping: dto.repMapping ?? { rotation: 0, flipped: false },
      canonical: {
        steps: dto.canonical.steps.map((s) => ({ a: (s as ArcStep).a, b: (s as ArcStep).b })),
        states: dto.canonical.states,
      },
      matrix: dto.matrix.map((layer) => ({
        depth: layer.depth,
        arcs: (layer.arcs ?? []).map((cell) => ({
          a: cell.a,
          b: cell.b,
          pathCount: BigInt(cell.pathCount),
          presence: cell.presence,
        })),
      })),
    };
  }
  return {
    topology: 'linear',
    n: dto.n,
    initial: dto.initial,
    distance: dto.distance,
    totalPaths: BigInt(dto.totalPaths),
    canonical: {
      steps: dto.canonical.steps.map((s) => ({
        start: (s as InversionStep).start,
        end: (s as InversionStep).end,
      })),
      states: dto.canonical.states,
    },
    matrix: dto.matrix.map((layer) => ({
      depth: layer.depth,
      intervals: (layer.intervals ?? []).map((cell) => ({
        start: cell.start,
        end: cell.end,
        pathCount: BigInt(cell.pathCount),
        presence: cell.presence,
      })),
    })),
  };
}
