/**
 * 带符号排列的倒位（reversal）最短方案审计。
 *
 * 支持两种拓扑：
 *   - linear（线性）：状态为带符号线性排列，倒位是闭区间 [i,j]（1 基）。
 *   - circular（环状）：不设固定首标记与观察链方向，循环旋转以及整体反向并
 *     翻号视为同一状态。切口 k 位于位置 k 与 k+1 之间，n 之后接 1；每次倒位
 *     由两个不同切口确定一段弧（互补两段弧给出商空间中的同一条边），整环
 *     操作（两切口重合）无效。每个状态取其全部 2n 个线性表示中字典序最小者
 *     作为规范表示，边以“当前规范表示下字典序最小的切口对”命名。
 *
 * 状态直接用压缩整数表示（见 permutation.ts 的 encodeState，每 4 位 nibble
 * 存 token+1）。线性 n<=7 时状态至多 2^n·n! ≈ 645120；环状商空间仅
 * 2^(n-1)·(n-1)!（n=7 时 23040），浏览器内可即时完成，因而所有结果都是
 * 精确的：
 *   - 最短步数；
 *   - 方案总数（bigint 任意精度累加，按十进制展示）；
 *   - 规范方案：全部最短方案中按“每步切口对序列”字典序最小者；
 *   - 深度×操作矩阵：逐格统计该操作在多少最短方案的该深度出现。
 *
 * 商图中同一状态对之间由互补弧或不同表示产生的重复边只计一次。
 */

import {
  applyInversion,
  decodeState,
  encodeState,
  tokenMagnitude,
  tokenToSigned,
  type Token,
} from './permutation';

export type Topology = 'linear' | 'circular';

/** 一次倒位：线性模式为 1 基闭区间 [start,end]；环状模式为切口对 (start,end)。 */
export interface InversionStep {
  start: number;
  end: number;
}

export type CellPresence = 'all' | 'some' | 'none';

export interface IntervalCell {
  start: number;
  end: number;
  /** 在深度 depth 执行该倒位的最短方案数量（bigint，精确） */
  pathCount: bigint;
  presence: CellPresence;
  /**
   * 仅环状模式：规范轨迹在该深度的规范状态上，是否存在以该切口对命名的
   * 最短边（用于点击矩阵后如实说明弧形高亮与规范轨迹的关系）。
   */
  onCanonical?: boolean;
  /**
   * 仅环状模式且该格被某条最短方案使用时：一个见证态——某条最短路径在该
   * 深度的规范源状态，在它的规范表示上该切口对的最小名字就是 (start,end)。
   * 供 UI 在该表示上画出切口对夹定的实际弧段。
   */
  witness?: Token[];
}

export interface AuditResult {
  topology: Topology;
  n: number;
  initial: Token[];
  /** 最少倒位步数 */
  distance: number;
  /** 全部最短方案总数（任意精度） */
  totalPaths: bigint;
  /** 规范方案：全最短方案中每步 (start,end) 序列字典序最小者 */
  canonical: {
    steps: InversionStep[];
    states: Token[][];
  };
  /**
   * 深度×操作矩阵。matrix[d] 给出深度 d（第 d+1 步）各操作的出现统计，
   * 操作按 (start,end) 字典序排列；depth 0 对应初始态的第一步。
   * 线性模式列为闭区间，环状模式列为切口对。
   */
  matrix: {
    depth: number;
    intervals: IntervalCell[];
  }[];
}

/* ------------------------------------------------------------------ *
 * 线性拓扑
 * ------------------------------------------------------------------ */

/** 在压缩状态 code 上枚举全部倒位邻居，按 (i,j) 字典序回调，零数组分配。 */
function eachLinearNeighbor(
  code: number,
  n: number,
  cb: (nextCode: number, start: number, end: number) => void,
): void {
  for (let i = 0; i < n; i += 1) {
    for (let j = i; j < n; j += 1) {
      let nextCode = code;
      // 先把区间内各位清零（取区间外的 nibble），再按反转+翻转填回。
      let mask = 0;
      for (let k = i; k <= j; k += 1) mask |= 0x0f << (4 * k);
      nextCode &= ~mask;
      for (let k = i; k <= j; k += 1) {
        // 存储 nibble = token+1；翻转后的存储值为 ((token ^ 1) + 1)。
        const stored = (code >>> (4 * (i + j - k))) & 0x0f;
        const flipped = ((stored - 1) ^ 1) + 1;
        nextCode |= flipped << (4 * k);
      }
      cb(nextCode, i + 1, j + 1);
    }
  }
}

function identityCode(n: number): number {
  let code = 0;
  for (let k = 0; k < n; k += 1) code |= (2 * k + 1) << (4 * k);
  return code;
}

/* ------------------------------------------------------------------ *
 * 环状拓扑：规范化（商掉循环旋转与整体反向翻号）
 * ------------------------------------------------------------------ */

/**
 * 返回环状状态的规范表示：枚举两个朝向（原样 / 整体反向并翻号）各 n 个
 * 循环旋转，按带符号整数序列字典序取最小。
 */
export function canonicalTokens(tokens: Token[]): Token[] {
  const n = tokens.length;
  const flipped: Token[] = new Array<number>(n);
  for (let k = 0; k < n; k += 1) flipped[k] = tokens[n - 1 - k] ^ 1;

  let best: Token[] | null = null;
  let bestSigned: number[] | null = null;
  for (let orient = 0; orient < 2; orient += 1) {
    const base = orient === 0 ? tokens : flipped;
    for (let s = 0; s < n; s += 1) {
      const rep: Token[] = new Array<number>(n);
      for (let k = 0; k < n; k += 1) rep[k] = base[(s + k) % n];
      if (best === null || bestSigned === null) {
        best = rep;
        bestSigned = rep.map(tokenToSigned);
        continue;
      }
      let cmp = 0;
      for (let k = 0; k < n; k += 1) {
        const v = tokenToSigned(rep[k]);
        if (v !== bestSigned[k]) {
          cmp = v < bestSigned[k] ? -1 : 1;
          break;
        }
      }
      if (cmp < 0) {
        best = rep;
        bestSigned = rep.map(tokenToSigned);
      }
    }
  }
  return best!;
}

/**
 * 环状模式枚举倒位邻居。
 *
 * 入参 code 必须是规范状态。对每个切口对 (a,b)（1 基，a<b，切口 k 位于
 * 位置 k 与 k+1 之间）取从切口 a 沿正向到切口 b 的弧（线性表示中的位置
 * a+1..b，即 0 基下标 a..b-1）做倒位，再规范化；互补弧给出同一商状态。
 * 同一后继（状态自身对称导致的重名/自环）只回调一次，并保留字典序最小
 * 的切口对作为该边的名字。
 */
function eachCircularNeighbor(
  code: number,
  n: number,
  cache: Map<number, number>,
  cb: (nextCode: number, start: number, end: number) => void,
): void {
  const tokens = decodeState(code, n);
  const seen = new Set<number>();
  for (let a = 1; a <= n; a += 1) {
    for (let b = a + 1; b <= n; b += 1) {
      // 弧段占据位置 a+1..b（1 基） => 0 基下标 [a, b-1]。
      const raw = applyInversion(tokens, a, b - 1);
      const rawCode = encodeState(raw);
      let nextCode = cache.get(rawCode);
      if (nextCode === undefined) {
        nextCode = encodeState(canonicalTokens(raw));
        cache.set(rawCode, nextCode);
      }
      // 整环/对称产生的自环不是有效边；不同切口对落到同一商状态只算一次。
      if (nextCode === code || seen.has(nextCode)) continue;
      seen.add(nextCode);
      cb(nextCode, a, b);
    }
  }
}

/* ------------------------------------------------------------------ *
 * 共用的 BFS 审计骨架
 * ------------------------------------------------------------------ */

interface NeighborEnumerator {
  (code: number, n: number, cb: (next: number, start: number, end: number) => void): void;
}

function audit(
  initial: Token[],
  topology: Topology,
  startCode: number,
  goalCode: number,
  eachNeighbor: NeighborEnumerator,
): AuditResult {
  const n = initial.length;

  if (startCode === goalCode) {
    // 目标态：距离 0、方案 1（空序列），矩阵为空。
    return {
      topology,
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
   * 3) 规范路径：沿前向 BFS 的最早父边回溯到初始态，再反序。
   *    环状枚举对同一后继保留字典序最小的切口对名字，因此该路径就是
   *    边名序列字典序最小的最短方案。
   * ------------------------------------------------------------------ */
  const steps: InversionStep[] = [];
  const stateCodesReversed: number[] = [goalCode];
  const statesReversed: Token[][] = [decodeState(goalCode, n)];
  let cursor = goalCode;
  while (cursor !== startCode) {
    const p = parent.get(cursor)!;
    steps.push({ start: p.start, end: p.end });
    stateCodesReversed.push(p.code);
    statesReversed.push(decodeState(p.code, n));
    cursor = p.code;
  }
  steps.reverse();
  stateCodesReversed.reverse();
  statesReversed.reverse();

  /* ------------------------------------------------------------------ *
   * 4) 逐层枚举最短边 (u,v)：distF[u]=d、distR[v]=distance-d-1。
   *    边方案数 = waysFromStart(u) * waysToGoal(v)，按操作聚合到矩阵格；
   *    waysFromStart 随层滚动。商图中每条状态对边只枚举一次。
   * ------------------------------------------------------------------ */
  const matrix: AuditResult['matrix'] = [];
  let waysFrom = new Map<number, bigint>([[startCode, 1n]]);

  // 全部操作按 (start,end) 字典序预登记，任何最短方案都没用到的保持 none。
  const allIntervals: { start: number; end: number }[] = [];
  if (topology === 'linear') {
    for (let i = 0; i < n; i += 1) {
      for (let j = i; j < n; j += 1) {
        allIntervals.push({ start: i + 1, end: j + 1 });
      }
    }
  } else {
    // 切口对：两个不同切口；整环（同一切口）无效。
    for (let a = 1; a <= n; a += 1) {
      for (let b = a + 1; b <= n; b += 1) {
        allIntervals.push({ start: a, end: b });
      }
    }
  }

  for (let d = 0; d < distance; d += 1) {
    const counts = new Map<string, bigint>();
    for (const { start, end } of allIntervals) {
      counts.set(`${start}:${end}`, 0n);
    }
    const nextWaysFrom = new Map<number, bigint>();
    // 环状模式：记录规范轨迹状态 stateCodesReversed[d] 上以各切口对命名的
    // 最短边，供 UI 判断点击的弧段是否真的落在所示规范环上；并为每个被
    // 使用的切口对保留一个见证态（其规范源状态码）。
    const pairsFromCanonState = new Set<string>();
    const witnessForKey = new Map<string, number>();

    for (const [uCode, waysU] of waysFrom) {
      eachNeighbor(uCode, n, (nextCode, start, end) => {
        if (distF.get(nextCode) !== d + 1) return;
        if (distR.get(nextCode) !== distance - d - 1) return;
        const key = `${start}:${end}`;
        counts.set(key, counts.get(key)! + waysU * waysToGoal.get(nextCode)!);
        nextWaysFrom.set(nextCode, (nextWaysFrom.get(nextCode) ?? 0n) + waysU);
        if (topology === 'circular') {
          if (uCode === stateCodesReversed[d]) pairsFromCanonState.add(key);
          if (!witnessForKey.has(key)) witnessForKey.set(key, uCode);
        }
      });
    }

    const intervals: IntervalCell[] = allIntervals.map(({ start, end }) => {
      const key = `${start}:${end}`;
      const pathCount = counts.get(key)!;
      const presence: CellPresence =
        pathCount === totalPaths ? 'all' : pathCount === 0n ? 'none' : 'some';
      const cell: IntervalCell = { start, end, pathCount, presence };
      if (topology === 'circular') {
        const onCanon = pairsFromCanonState.has(key);
        cell.onCanonical = onCanon;
        // 该切口对就在规范轨迹状态上时，以它为见证态（同一环序、另一条
        // 最短弧）；否则取第一个实际以该名字出现的等价规范状态。
        const witnessCode = onCanon
          ? stateCodesReversed[d]
          : witnessForKey.get(key);
        if (witnessCode !== undefined) cell.witness = decodeState(witnessCode, n);
      }
      return cell;
    });
    matrix.push({ depth: d, intervals });
    waysFrom = nextWaysFrom;
  }

  return {
    topology,
    n,
    initial,
    distance,
    totalPaths,
    canonical: { steps, states: statesReversed },
    matrix,
  };
}

/* ------------------------------------------------------------------ *
 * 入口
 * ------------------------------------------------------------------ */

export function solve(initial: Token[], topology: Topology = 'linear'): AuditResult {
  const n = initial.length;
  if (topology === 'linear') {
    const startCode = encodeState(initial);
    return audit(initial, 'linear', startCode, identityCode(n), eachLinearNeighbor);
  }

  const canon = canonicalTokens(initial);
  const startCode = encodeState(canon);
  const goalTokens = canonicalTokens(Array.from({ length: n }, (_, k) => 2 * k));
  const goalCode = encodeState(goalTokens);
  // 环状邻居枚举共享规范化缓存（原始线性码 -> 规范码）。
  const cache = new Map<number, number>();
  const eachCircular: NeighborEnumerator = (code, nn, cb) =>
    eachCircularNeighbor(code, nn, cache, cb);
  return audit(canon, 'circular', startCode, goalCode, eachCircular);
}

/**
 * 环状工具：给定规范状态与切口对 (a,b)，返回正向弧（位置 a+1..b）上的
 * 标记绝对值（1 基位置），供环形轨迹在重新规范化后按标记身份持续高亮。
 */
export function arcMagnitudes(state: Token[], start: number, end: number): Set<number> {
  const hit = new Set<number>();
  for (let k = start; k <= end - 1; k += 1) hit.add(tokenMagnitude(state[k]));
  return hit;
}

/**
 * 环状轨迹显示用：在“与上一帧保持同一旋转/朝向”的线性化 display 上，
 * 对由标记绝对值集合 hitMagnitudes 指定的弧段执行倒位。弧段在显示坐标中
 * 必为循环连续的一段；先旋转使其成为普通区间再倒位、再转回，这样逐步
 * 浏览时只有弧内标记移动翻转，不会因重新规范化而让标记跳到错误位置。
 */
export function advanceDisplay(
  display: Token[],
  hitMagnitudes: Set<number>,
): Token[] {
  const n = display.length;
  const inArc = display.map((t) => hitMagnitudes.has(tokenMagnitude(t)));
  let start = -1;
  for (let i = 0; i < n; i += 1) {
    if (inArc[i] && !inArc[(i - 1 + n) % n]) {
      start = i;
      break;
    }
  }
  if (start === -1) return display.slice();
  let len = 0;
  for (const hit of inArc) if (hit) len += 1;

  const rotated: Token[] = new Array<number>(n);
  for (let k = 0; k < n; k += 1) rotated[k] = display[(start + k) % n];
  const inverted = applyInversion(rotated, 0, len - 1);
  const out: Token[] = new Array<number>(n);
  for (let k = 0; k < n; k += 1) out[(start + k) % n] = inverted[k];
  return out;
}

/** 判断两个线性化是否表示同一环状状态（旋转 / 整体反向翻号等价）。 */
export function sameCircularState(a: Token[], b: Token[]): boolean {
  return encodeState(canonicalTokens(a)) === encodeState(canonicalTokens(b));
}

/**
 * 给定同一环状状态的两个线性化，判断 frame 相对 reference 是同向
 * （仅差循环旋转）还是反向（差整体反向翻号，可能再带旋转）。
 * 用于在沿用固定坐标的显示帧上还原规范切口编号。
 */
export function relativeOrientation(
  frame: Token[],
  reference: Token[],
): 'same' | 'opposite' {
  const n = frame.length;
  for (let s = 0; s < n; s += 1) {
    let same = true;
    for (let k = 0; k < n; k += 1) {
      if (frame[k] !== reference[(s + k) % n]) {
        same = false;
        break;
      }
    }
    if (same) return 'same';
  }
  return 'opposite';
}

/** Worker 传输用 DTO：bigint 不能依赖所有环境的结构化克隆，统一转十进制字符串。 */
export interface AuditResultDTO {
  topology: Topology;
  n: number;
  initial: Token[];
  distance: number;
  totalPaths: string;
  canonical: {
    steps: InversionStep[];
    states: Token[][];
  };
  matrix: {
    depth: number;
    intervals: {
      start: number;
      end: number;
      pathCount: string;
      presence: CellPresence;
      onCanonical?: boolean;
      witness?: Token[];
    }[];
  }[];
}

export function toDTO(result: AuditResult): AuditResultDTO {
  return {
    topology: result.topology,
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
        ...(cell.onCanonical === undefined ? {} : { onCanonical: cell.onCanonical }),
        ...(cell.witness === undefined ? {} : { witness: cell.witness }),
      })),
    })),
  };
}

export function fromDTO(dto: AuditResultDTO): AuditResult {
  return {
    topology: dto.topology,
    n: dto.n,
    initial: dto.initial,
    distance: dto.distance,
    totalPaths: BigInt(dto.totalPaths),
    canonical: dto.canonical,
    matrix: dto.matrix.map((layer) => ({
      depth: layer.depth,
      intervals: layer.intervals.map((cell) => ({
        start: cell.start,
        end: cell.end,
        pathCount: BigInt(cell.pathCount),
        presence: cell.presence,
        ...(cell.onCanonical === undefined ? {} : { onCanonical: cell.onCanonical }),
        ...(cell.witness === undefined ? {} : { witness: cell.witness }),
      })),
    })),
  };
}
