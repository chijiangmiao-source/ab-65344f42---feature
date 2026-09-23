import { describe, expect, it } from 'vitest';
import {
  applyInversion,
  encodeToken,
  tokenToSigned,
  type Token,
} from './permutation';
import {
  arcMagnitudes,
  advanceDisplay,
  canonicalTokens,
  sameCircularState,
  solve,
  type InversionStep,
} from './solver';

function tokensOf(values: number[]): Token[] {
  return values.map(encodeToken);
}

function signedOf(tokens: Token[]): number[] {
  return tokens.map(tokenToSigned);
}

/** 独立的环状暴力模型：在商空间（旋转 + 整体反向翻号）上 BFS/DFS。 */
function canonKey(values: number[]): string {
  const n = values.length;
  const revFlip = values
    .slice()
    .reverse()
    .map((v) => -v);
  const reps: number[][] = [];
  for (const base of [values, revFlip]) {
    for (let s = 0; s < n; s += 1) {
      reps.push(base.slice(s).concat(base.slice(0, s)));
    }
  }
  reps.sort((a, b) => {
    for (let k = 0; k < n; k += 1) {
      if (a[k] !== b[k]) return a[k] - b[k];
    }
    return 0;
  });
  return reps[0].join(',');
}

/** 返回某商状态在其规范表示上的去重邻居：后继 key -> 最小切口对 (a,b)（1 基）。 */
function circularEdges(
  values: number[],
): Map<string, { a: number; b: number; rep: number[] }> {
  const n = values.length;
  // values 必须是规范表示
  const edges = new Map<string, { a: number; b: number; rep: number[] }>();
  for (let a = 1; a <= n; a += 1) {
    for (let b = a + 1; b <= n; b += 1) {
      // 弧 = 位置 a+1..b（1 基） => 0 基 [a, b-1]
      const raw = applyInversion(tokensOf(values), a, b - 1);
      const nextSigned = signedOf(raw);
      const key = canonKey(nextSigned);
      if (key === canonKey(values)) continue; // 自环（整环/对称）无效
      if (!edges.has(key)) edges.set(key, { a, b, rep: nextSigned });
    }
  }
  return edges;
}

function canonicalValues(values: number[]): number[] {
  return signedOf(canonicalTokens(tokensOf(values)));
}

function bruteCircular(values: number[]): {
  distance: number;
  total: number;
  lexMin: InversionStep[];
} {
  const n = values.length;
  const startKey = canonKey(values);
  const goalKey = canonKey(Array.from({ length: n }, (_, k) => k + 1));

  const dist = new Map<string, number>([[startKey, 0]]);
  const repOf = new Map<string, number[]>([[startKey, canonicalValues(values)]]);
  const queue = [startKey];
  for (let head = 0; head < queue.length; head += 1) {
    const key = queue[head];
    if (key === goalKey) break;
    const d = dist.get(key)!;
    for (const [nextKey, edge] of circularEdges(repOf.get(key)!)) {
      if (!dist.has(nextKey)) {
        dist.set(nextKey, d + 1);
        repOf.set(nextKey, canonicalValues(edge.rep));
        queue.push(nextKey);
      }
    }
  }
  const distance = dist.get(goalKey)!;

  let total = 0;
  let lexMin: InversionStep[] | null = null;
  const walk = (key: string, path: InversionStep[]) => {
    if (key === goalKey) {
      total += 1;
      if (lexMin === null || lexLess(path, lexMin)) lexMin = path.slice();
      return;
    }
    const d = dist.get(key)!;
    for (const [nextKey, edge] of circularEdges(repOf.get(key)!)) {
      if (dist.get(nextKey) === d + 1 && dist.get(nextKey)! <= distance) {
        path.push({ start: edge.a, end: edge.b });
        walk(nextKey, path);
        path.pop();
      }
    }
  };
  walk(startKey, []);
  return { distance, total, lexMin: lexMin! };
}

function lexLess(a: InversionStep[], b: InversionStep[]): boolean {
  for (let k = 0; k < Math.max(a.length, b.length); k += 1) {
    const x = a[k];
    const y = b[k];
    if (x === undefined) return true;
    if (y === undefined) return false;
    if (x.start !== y.start) return x.start < y.start;
    if (x.end !== y.end) return x.end < y.end;
  }
  return false;
}

const perms = (arr: number[]): number[][] =>
  arr.length <= 1
    ? [arr]
    : arr.flatMap((v, i) =>
        perms(arr.filter((_, k) => k !== i)).map((p) => [v, ...p]),
      );

describe('环状规范化', () => {
  it('旋转等价', () => {
    expect(canonKey([1, -3, 2])).toBe(canonKey([2, 1, -3]));
    expect(canonKey([1, -3, 2])).toBe(canonKey([-3, 2, 1]));
  });

  it('整体反向并翻号等价', () => {
    expect(canonKey([1, -3, 2])).toBe(canonKey([-2, 3, -1]));
  });

  it('规范表示取全部 2n 个表示中的字典序最小者', () => {
    expect(canonicalValues([3, 2, 1])).toEqual(canonKey([3, 2, 1]).split(',').map(Number));
    // [-1,-2,-3] 与 [3,2,1] 同态
    expect(canonKey([-1, -2, -3])).toBe(canonKey([3, 2, 1]));
  });

  it('正向环序的任何旋转/反向翻号表示距离为 0', () => {
    for (const v of [
      [1, 2, 3, 4],
      [3, 4, 1, 2],
      [-1, -4, -3, -2], // reverse([1,2,3,4]) 取反
    ]) {
      const r = solve(tokensOf(v), 'circular');
      expect(r.distance).toBe(0);
      expect(r.totalPaths).toBe(1n);
      expect(r.matrix).toEqual([]);
    }
  });
});

describe('环状操作语义', () => {
  it('只有 C(n,2) 个切口对：两切口须不同（整环无效），无 a=b', () => {
    const r = solve(tokensOf([1, -3, 2]), 'circular');
    const n = 3;
    expect(r.matrix.length).toBeGreaterThan(0);
    const cols = r.matrix[0].intervals;
    expect(cols.length).toBe((n * (n - 1)) / 2);
    for (const c of cols) expect(c.start).toBeLessThan(c.end);
  });

  it('互补弧给出同一商状态', () => {
    // n=4：倒位位置 1（切口 4 与 1）与倒位位置 2..4（切口 1 与 4，名 (1,4)）
    // 落到同一商状态。
    const v = [1, 2, 3, -4];
    const one = applyInversion(tokensOf(v), 0, 0); // 位置1
    const rest = applyInversion(tokensOf(v), 1, 3); // 位置2..4
    expect(canonKey(signedOf(one))).toBe(canonKey(signedOf(rest)));
  });

  it('跨首尾倒位在环状模式可选：存在环状距离严格小于线性距离的情形', () => {
    // [-1,2,3]：线性需单点翻转位置1（线性距离 1，这里相等）；改用必须借助
    // 跨接缝重排的例子 [2,3,...,n,1] 的带符号变体由全枚举测试保证。这里
    // 直接验证 [3,-2,-1]：环上一次跨首尾倒位即可到正向环序。
    const rc = solve(tokensOf([3, -2, -1]), 'circular');
    const rl = solve(tokensOf([3, -2, -1]), 'linear');
    expect(rc.distance).toBe(1);
    expect(rc.distance).toBeLessThan(rl.distance);
  });
});

describe('环状审计与暴力商空间交叉验证（n=3 全部，n=4 抽样）', () => {
  const cases: number[][] = [];
  for (const order of perms([1, 2, 3])) {
    for (let mask = 0; mask < 1 << 3; mask += 1) {
      cases.push(order.map((v, k) => (mask & (1 << k) ? -v : v)));
    }
  }
  for (const order of perms([1, 2, 3, 4]).slice(0, 40)) {
    cases.push(order.map((v) => (v % 2 === 0 ? -v : v)));
  }

  for (const c of cases) {
    it(`case ${JSON.stringify(c)}`, () => {
      const r = solve(tokensOf(c), 'circular');
      const b = bruteCircular(c);
      expect(r.distance).toBe(b.distance);
      expect(r.totalPaths).toBe(BigInt(b.total));
      expect(r.canonical.steps).toEqual(b.lexMin);

      // 规范轨迹可行：在逐深度规范表示上应用命名切口对，下一步后所得状态
      // 必须与下一帧规范态同态；最终到达正向环序。
      let cur = r.canonical.states[0].slice();
      for (let d = 0; d < r.distance; d += 1) {
        const s = r.canonical.steps[d];
        const raw = applyInversion(cur, s.start, s.end - 1);
        cur = canonicalTokens(raw);
        expect(sameCircularState(cur, r.canonical.states[d + 1])).toBe(true);
      }
      expect(canonKey(signedOf(cur))).toBe(
        canonKey(Array.from({ length: c.length }, (_, k) => k + 1)),
      );

      // 矩阵不变量：每行之和为总方案数；presence 与计数一致。
      for (const layer of r.matrix) {
        let sum = 0n;
        for (const cell of layer.intervals) {
          sum += cell.pathCount;
          if (cell.presence === 'all') expect(cell.pathCount).toBe(r.totalPaths);
          if (cell.presence === 'none') expect(cell.pathCount).toBe(0n);
          if (cell.presence === 'some') {
            expect(cell.pathCount > 0n).toBe(true);
            expect(cell.pathCount < r.totalPaths).toBe(true);
          }
          // onCanonical 与该格计数：规范边上的格必被使用
          if (cell.onCanonical) expect(cell.pathCount > 0n).toBe(true);
          if (cell.pathCount > 0n) expect(cell.witness).toBeDefined();
        }
        expect(sum).toBe(r.totalPaths);
      }
    });
  }

  it('同一物理环的旋转与反向翻号表示给出完全相同的审计结论', () => {
    const base = [1, -3, -2, 4];
    const variants = [
      base,
      [-2, 4, 1, -3], // 旋转
      [-4, 2, 3, -1], // 整体反向翻号
      [3, -1, -4, 2], // 先旋转再反向翻号
    ];
    const ref = solve(tokensOf(base), 'circular');
    for (const v of variants.slice(1)) {
      const r = solve(tokensOf(v), 'circular');
      expect(r.distance).toBe(ref.distance);
      expect(r.totalPaths).toBe(ref.totalPaths);
      expect(r.canonical.steps).toEqual(ref.canonical.steps);
    }
  });
});

describe('环状显示链（逐步浏览不因重新规范化跳错标记）', () => {
  it('每帧与同深度规范态同态，且高亮弧上的正是被倒位的标记', () => {
    const cases = [
      [3, -2, -1],
      [-1, -2, -3, 4],
      [3, 2, 1],
      [-7, 6, -5, 4, -3, 2, -1],
    ];
    for (const c of cases) {
      const r = solve(tokensOf(c), 'circular');
      let display = r.canonical.states[0].slice();
      for (let d = 0; d < r.distance; d += 1) {
        const s = r.canonical.steps[d];
        const canon = r.canonical.states[d];
        const hit = arcMagnitudes(canon, s.start, s.end);
        // 弧上标记数 = 弧长（end-start），互补弧不会被命名为该切口对
        expect(hit.size).toBe(s.end - s.start);
        display = advanceDisplay(display, hit);
        expect(sameCircularState(display, r.canonical.states[d + 1])).toBe(true);
        // 显示帧中弧标记仍循环连续
        const n = display.length;
        const flags = display.map((t) => hit.has(Math.floor(t / 2) + 1));
        const runs = flags.filter((f, i) => f && !flags[(i - 1 + n) % n]).length;
        expect(runs).toBe(1);
      }
    }
  });
});
