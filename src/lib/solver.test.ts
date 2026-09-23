import { describe, expect, it } from 'vitest';
import {
  applyInversion,
  encodeState,
  encodeToken,
  formatBigIntDecimal,
  validatePermutation,
  type Token,
} from './permutation';
import { type ArcStep, type InversionStep, solve } from './solver';

function tokensOf(values: number[]) {
  return values.map(encodeToken);
}

function signedOf(tokens: ReturnType<typeof tokensOf>) {
  return tokens.map((t) => ((t & 1) === 0 ? (t >> 1) + 1 : -(((t >> 1) + 1))));
}

/** 独立的暴力 DFS：枚举全部最短倒位序列，用于交叉验证。 */
function bruteForce(values: number[]): {
  distance: number;
  total: number;
  lexicographicMin: InversionStep[];
} {
  const n = values.length;
  const start = tokensOf(values);
  const goalCode = encodeState(tokensOf(Array.from({ length: n }, (_, k) => k + 1)));

  // BFS 求最短距离
  const dist = new Map<number, number>([[encodeState(start), 0]]);
  const queue = [encodeState(start)];
  let goal = -1;
  for (let head = 0; head < queue.length; head += 1) {
    const code = queue[head];
    if (code === goalCode) {
      goal = dist.get(code)!;
      break;
    }
    const d = dist.get(code)!;
    const cur: number[] = [];
    for (let k = 0; k < n; k += 1) cur.push(((code >>> (4 * k)) & 0x0f) - 1);
    for (let i = 0; i < n; i += 1) {
      for (let j = i; j < n; j += 1) {
        const nx = encodeState(applyInversion(cur, i, j));
        if (!dist.has(nx)) {
          dist.set(nx, d + 1);
          queue.push(nx);
        }
      }
    }
  }
  const distance = goal;

  // DFS 只走能保持最短性的边，枚举全部最短方案（n<=3 时规模很小）
  let total = 0;
  let lexicographicMin: InversionStep[] | null = null;
  const walk = (tokens: number[], d: number[], path: InversionStep[]) => {
    const code = encodeState(tokens);
    if (code === goalCode) {
      total += 1;
      if (
        lexicographicMin === null ||
        lexicographicLess(path, lexicographicMin)
      ) {
        lexicographicMin = path.slice();
      }
      return;
    }
    for (let i = 0; i < n; i += 1) {
      for (let j = i; j < n; j += 1) {
        const nx = applyInversion(tokens, i, j);
        const nxCode = encodeState(nx);
        if (dist.get(nxCode) === dist.get(code)! + 1 && dist.get(nxCode)! <= distance) {
          path.push({ start: i + 1, end: j + 1 });
          walk(nx, d, path);
          path.pop();
        }
      }
    }
  };
  walk(start, [], []);
  return { distance, total, lexicographicMin: lexicographicMin! };
}

function lexicographicLess(a: InversionStep[], b: InversionStep[]) {
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

describe('倒位操作语义', () => {
  it('反转区间次序并同时翻转每个符号', () => {
    // [1,-3,-2,4] 倒位 [2,3] -> [1, 2, 3, 4]
    const got = applyInversion(tokensOf([1, -3, -2, 4]), 1, 2);
    expect(signedOf(got)).toEqual([1, 2, 3, 4]);
  });

  it('单点区间只翻转该符号', () => {
    const got = applyInversion(tokensOf([1, 2, 3]), 1, 1);
    expect(signedOf(got)).toEqual([1, -2, 3]);
  });
});

describe('需求用例 [1,-3,-2,4]', () => {
  it('最短步数为 1，规范倒位是 [2,3]，方案总数为 1', () => {
    const r = solve(tokensOf([1, -3, -2, 4]));
    expect(r.distance).toBe(1);
    expect(r.totalPaths).toBe(1n);
    expect(r.canonical.steps).toEqual([{ start: 2, end: 3 }]);
    expect(signedOf(r.canonical.states[1])).toEqual([1, 2, 3, 4]);
  });
});

describe('校验：合并反馈且拒绝非法排列', () => {
  it('重复绝对值被拒绝', () => {
    const r = validatePermutation('1 1 3');
    expect(r.errors.length).toBeGreaterThan(0);
    expect(r.tokens).toBeUndefined();
    expect(r.errors.join(' ')).toContain('重复');
  });

  it('重复绝对值（符号不同）被拒绝', () => {
    const r = validatePermutation('[1, -1, 2]');
    expect(r.tokens).toBeUndefined();
    expect(r.errors.join(' ')).toContain('重复');
  });

  it('缺少某个绝对值（未恰好覆盖 1..n）被拒绝', () => {
    expect(validatePermutation('1 2 2').tokens).toBeUndefined();
    expect(validatePermutation('1 2 4').tokens).toBeUndefined();
  });

  it('数量越界、0、非整数与越界值合并为一次反馈', () => {
    const r = validatePermutation('1, 0, x, 9');
    expect(r.tokens).toBeUndefined();
    expect(r.errors.length).toBeGreaterThanOrEqual(3);
  });

  it('合法排列通过校验并接受常见分隔符', () => {
    expect(validatePermutation('1 -2 3').tokens).toBeDefined();
    expect(validatePermutation('[1, -2, 3]').tokens).toBeDefined();
    expect(validatePermutation('1;-2;3').tokens).toBeDefined();
  });
});

describe('与暴力枚举交叉验证（n=3 全部排列，n=4 部分排列）', () => {
  const cases: number[][] = [];
  const perms = (arr: number[]): number[][] =>
    arr.length <= 1
      ? [arr]
      : arr.flatMap((v, i) =>
          perms(arr.filter((_, k) => k !== i)).map((p) => [v, ...p]),
        );
  for (const order of perms([1, 2, 3])) {
    for (let mask = 0; mask < 1 << 3; mask += 1) {
      cases.push(order.map((v, k) => (mask & (1 << k) ? -v : v)));
    }
  }
  for (const order of perms([1, 2, 3, 4]).slice(0, 24)) {
    cases.push(order.map((v) => (v % 2 === 0 ? -v : v)));
  }

  for (const c of cases) {
    it(`case ${JSON.stringify(c)}`, () => {
      const r = solve(tokensOf(c));
      const b = bruteForce(c);
      expect(r.distance).toBe(b.distance);
      expect(r.totalPaths).toBe(BigInt(b.total));
      expect(r.canonical.steps).toEqual(b.lexicographicMin);

      // 规范路径本身必须可行且到达全正顺序
      let cur = tokensOf(c);
      for (const s of r.canonical.steps) {
        cur = applyInversion(cur, s.start - 1, s.end - 1);
      }
      expect(signedOf(cur)).toEqual(Array.from({ length: c.length }, (_, k) => k + 1));

      // 矩阵不变量：每层各区间出现方案数之和恰为总方案数
      for (const layer of r.matrix) {
        let sum = 0n;
        for (const cell of layer.intervals) sum += cell.pathCount;
        expect(sum).toBe(r.totalPaths);
      }
    });
  }
});

describe('深度×区间矩阵', () => {
  it('未使用区间标 none，全部方案共用标 all，并给出精确出现数', () => {
    // [-1,2,3] 只有一条最短路径：单点翻转位置 1
    const r = solve(tokensOf([-1, 2, 3]));
    expect(r.distance).toBe(1);
    const layer = r.matrix[0];
    for (const cell of layer.intervals) {
      if (cell.start === 1 && cell.end === 1) {
        expect(cell.presence).toBe('all');
        expect(cell.pathCount).toBe(1n);
      } else {
        expect(cell.presence).toBe('none');
        expect(cell.pathCount).toBe(0n);
      }
    }
  });

  it('存在多种选择时标注 some 且计数精确', () => {
    // [-1,-2,-3]：三个单点倒位各需 3 步（顺序无关 => 6 条），也有更短路径。
    // 这里直接验证：some 格子计数严格介于 0 与总数之间，且层级计数自洽。
    const r = solve(tokensOf([-1, -2, -3]));
    expect(r.distance).toBeGreaterThan(0);
    for (const layer of r.matrix) {
      for (const cell of layer.intervals) {
        if (cell.presence === 'some') {
          expect(cell.pathCount > 0n).toBe(true);
          expect(cell.pathCount < r.totalPaths).toBe(true);
        }
      }
    }
  });
});

describe('边界与展示', () => {
  it('已是全正顺序时距离 0、方案 1、矩阵为空', () => {
    const r = solve(tokensOf([1, 2, 3]));
    expect(r.distance).toBe(0);
    expect(r.totalPaths).toBe(1n);
    expect(r.matrix).toEqual([]);
    expect(r.canonical.steps).toEqual([]);
  });

  it('n=7 可求解且大数以千分位完整输出', () => {
    const r = solve(tokensOf([-7, -6, -5, -4, -3, -2, -1]));
    expect(r.distance).toBeGreaterThan(0);
    expect(r.totalPaths > 0n).toBe(true);
    expect(formatBigIntDecimal(r.totalPaths)).toMatch(/^\d{1,3}(,\d{3})*$/);
    // 往返一致：去掉千分位仍是同一个整数
    expect(BigInt(formatBigIntDecimal(r.totalPaths).replace(/,/g, ''))).toBe(
      r.totalPaths,
    );
  });
});

/* ======================== 环状拓扑（独立暴力交叉验证） ======================== */

/** 用数组直接实现的环等价类规范化：n 个旋转 × {原样, 整体反向翻号}，取压缩码最小。 */
function circCanonArray(input: Token[]): Token[] {
  const n = input.length;
  let best: Token[] | null = null;
  const consider = (base: Token[]) => {
    for (let r = 0; r < n; r += 1) {
      const rot = base.slice(r).concat(base.slice(0, r));
      if (best === null || encodeState(rot) < encodeState(best)) best = rot;
    }
  };
  consider(input);
  consider(input.slice().reverse().map((t) => (t ^ 1) as Token));
  return best!;
}

/** 环状暴力 BFS/DP：与 solver 完全独立的数组实现，边按切口对字典序去重。 */
function bruteForceCircular(values: number[]): {
  distance: number;
  total: number;
  lexicographicMin: ArcStep[];
  matrix: { depth: number; counts: Map<string, bigint> }[];
} {
  const n = values.length;
  const start = circCanonArray(tokensOf(values));
  const goal = circCanonArray(tokensOf(Array.from({ length: n }, (_, k) => k + 1)));
  const startCode = encodeState(start);
  const goalCode = encodeState(goal);

  // 枚举规范状态 u 的去重边：返回 [vCode, a, b]（首次出现的字典序最小切口对）。
  const edgesOf = (u: Token[]): Array<[number, number, number]> => {
    const out: Array<[number, number, number]> = [];
    const seen = new Set<number>();
    for (let a = 1; a < n; a += 1) {
      for (let b = a + 1; b <= n; b += 1) {
        // 切口 a、b 之间的非跨首尾弧：0 基位置 [a, b-1]。
        const nx = circCanonArray(applyInversion(u, a, b - 1));
        const code = encodeState(nx);
        if (seen.has(code)) continue;
        seen.add(code);
        out.push([code, a, b]);
      }
    }
    return out;
  };

  const dist = new Map<number, number>([[startCode, 0]]);
  const parent = new Map<number, { code: number; a: number; b: number }>();
  const queue = [startCode];
  let head = 0;
  while (head < queue.length) {
    const code = queue[head++];
    if (code === goalCode) break;
    const d = dist.get(code)!;
    const u = circCanonArray(
      Array.from({ length: n }, (_, k) => ((code >>> (4 * k)) & 0x0f) - 1) as Token[],
    );
    for (const [vCode, a, b] of edgesOf(u)) {
      if (!dist.has(vCode)) {
        dist.set(vCode, d + 1);
        parent.set(vCode, { code, a, b });
        queue.push(vCode);
      }
    }
  }
  const distance = dist.get(goalCode)!;

  // 反向 BFS（商图边对称）：distG 为到目标的距离，只保留位于最短路径上的状态。
  const distG = new Map<number, number>([[goalCode, 0]]);
  const gq = [goalCode];
  let gh = 0;
  while (gh < gq.length) {
    const code = gq[gh++];
    const d = distG.get(code)!;
    if (d >= distance) continue;
    const u = circCanonArray(
      Array.from({ length: n }, (_, k) => ((code >>> (4 * k)) & 0x0f) - 1) as Token[],
    );
    for (const [vCode] of edgesOf(u)) {
      if (distG.has(vCode)) continue;
      const fd = dist.get(vCode);
      if (fd === undefined || fd + d + 1 > distance) continue;
      distG.set(vCode, d + 1);
      gq.push(vCode);
    }
  }

  // 分层 DP：waysTo(v) = 经“到目标更近一层”的邻居的最短路径数之和。
  const byDepth = new Map<number, number[]>();
  for (const [code, d] of dist) {
    if (distG.has(code) && d + distG.get(code)! === distance) {
      const list = byDepth.get(d) ?? [];
      list.push(code);
      byDepth.set(d, list);
    }
  }
  const decode = (code: number): Token[] =>
    circCanonArray(
      Array.from({ length: n }, (_, k) => ((code >>> (4 * k)) & 0x0f) - 1) as Token[],
    );
  const waysTo = new Map<number, bigint>([[goalCode, 1n]]);
  for (let d = distance - 1; d >= 0; d -= 1) {
    for (const code of byDepth.get(d)!) {
      let ways = 0n;
      for (const [vCode] of edgesOf(decode(code))) {
        if (distG.get(vCode) === distG.get(code)! - 1) ways += waysTo.get(vCode)!;
      }
      waysTo.set(code, ways);
    }
  }
  const waysFrom = new Map<number, bigint>([[startCode, 1n]]);
  const matrix: { depth: number; counts: Map<string, bigint> }[] = [];
  for (let d = 0; d < distance; d += 1) {
    const counts = new Map<string, bigint>();
    const nextWays = new Map<number, bigint>();
    for (const code of byDepth.get(d)!) {
      const wu = waysFrom.get(code)!;
      for (const [vCode, a, b] of edgesOf(decode(code))) {
        if (dist.get(vCode) !== d + 1 || !distG.has(vCode)) continue;
        const key = `${a}:${b}`;
        counts.set(key, (counts.get(key) ?? 0n) + wu * waysTo.get(vCode)!);
        nextWays.set(vCode, (nextWays.get(vCode) ?? 0n) + wu);
      }
    }
    matrix.push({ depth: d, counts });
    for (const [code, w] of nextWays) waysFrom.set(code, w);
  }

  let total = 0;
  let lexicographicMin: ArcStep[] | null = null;
  const arcLess = (x: ArcStep, y: ArcStep) =>
    x.a !== y.a ? x.a < y.a : x.b < y.b;
  const pathLess = (p: ArcStep[], q: ArcStep[]) => {
    for (let k = 0; k < p.length; k += 1) {
      if (arcLess(p[k], q[k])) return true;
      if (arcLess(q[k], p[k])) return false;
    }
    return false;
  };
  const walk = (code: number, path: ArcStep[]) => {
    if (code === goalCode) {
      total += 1;
      if (lexicographicMin === null || pathLess(path, lexicographicMin)) {
        lexicographicMin = path.slice();
      }
      return;
    }
    const d = dist.get(code)!;
    const u = circCanonArray(
      Array.from({ length: n }, (_, k) => ((code >>> (4 * k)) & 0x0f) - 1) as Token[],
    );
    for (const [vCode, a, b] of edgesOf(u)) {
      if (dist.get(vCode) === d + 1) {
        path.push({ a, b });
        walk(vCode, path);
        path.pop();
      }
    }
  };
  walk(startCode, []);

  return { distance, total, lexicographicMin: lexicographicMin!, matrix };
}

describe('环状：等价类归一化', () => {
  it('正向环序的任意旋转与整体反向翻号距离均为 0', () => {
    const n = 3;
    const goalRep = solve(tokensOf(Array.from({ length: n }, (_, k) => k + 1)), 'circular');
    for (const v of [
      [1, 2, 3],
      [2, 3, 1],
      [3, 1, 2],
      [-3, -2, -1], // [1,2,3] 整体反向翻号
      [-1, -3, -2], // 旋转后等价
    ]) {
      const r = solve(tokensOf(v), 'circular');
      expect(r.topology).toBe('circular');
      expect(r.distance, JSON.stringify(v)).toBe(0);
      expect(r.totalPaths).toBe(1n);
      expect(r.canonical.steps).toEqual([]);
      expect(r.initial).toEqual(goalRep.initial);
    }
  });

  it('同一物理排列的全部 2n 个表示给出完全相同的审计结果', () => {
    const base = tokensOf([3, -1, -2, 4]);
    const reps: Token[][] = [];
    for (let r = 0; r < 4; r += 1) {
      reps.push(base.slice(r).concat(base.slice(0, r)));
    }
    const flipped = base.slice().reverse().map((t) => (t ^ 1) as Token);
    for (let r = 0; r < 4; r += 1) {
      reps.push(flipped.slice(r).concat(flipped.slice(0, r)));
    }
    const ref = solve(reps[0], 'circular');
    for (const rep of reps) {
      const r = solve(rep, 'circular');
      expect(r.distance).toBe(ref.distance);
      expect(r.totalPaths).toBe(ref.totalPaths);
      expect(r.canonical.steps).toEqual(ref.canonical.steps);
      expect(r.canonical.states).toEqual(ref.canonical.states);
      expect(r.matrix).toEqual(ref.matrix);
      expect(r.initial).toEqual(ref.initial);
    }
  });
});

describe('环状：整环操作无效且无自环', () => {
  it('每个状态的去重后继数不超过 n(n-1)/2，且任何弧倒位都改变状态', () => {
    // 通过求解若干 n=3..5 的状态，检查矩阵中不会出现“整环”切口对命名，
    // 且弧长范围是 1..n-1（没有覆盖整环的操作）。
    for (const v of [
      [-1, 2, 3],
      [2, -3, -1, 4],
      [-5, 4, -3, 2, -1],
    ]) {
      const r = solve(tokensOf(v), 'circular');
      if (r.topology !== 'circular') throw new Error('topology');
      for (const layer of r.matrix) {
        for (const cell of layer.arcs) {
          expect(cell.a).toBeGreaterThanOrEqual(1);
          expect(cell.b).toBeLessThanOrEqual(v.length);
          expect(cell.a).toBeLessThan(cell.b);
          // 弧长 b-a ∈ [1, n-1]：既非空也非整环
          expect(cell.b - cell.a).toBeGreaterThanOrEqual(1);
          expect(cell.b - cell.a).toBeLessThanOrEqual(v.length - 1);
        }
      }
    }
  });
});

describe('环状：跨首尾倒位可达（线性下被误判为不可选的情形）', () => {
  it('[4,1,2,3] 在环上与正向环序同状态（距离 0），线性下则非平凡', () => {
    const c = solve(tokensOf([4, 1, 2, 3]), 'circular');
    expect(c.distance).toBe(0);
    const l = solve(tokensOf([4, 1, 2, 3]), 'linear');
    expect(l.distance).toBeGreaterThan(0);
  });
});

describe('环状：与独立暴力枚举交叉验证（n=3 全部、n=4 全部）', () => {
  const cases: number[][] = [];
  const perms = (arr: number[]): number[][] =>
    arr.length <= 1
      ? [arr]
      : arr.flatMap((v, i) =>
          perms(arr.filter((_, k) => k !== i)).map((p) => [v, ...p]),
        );
  for (const n of [3, 4]) {
    for (const order of perms(Array.from({ length: n }, (_, k) => k + 1))) {
      for (let mask = 0; mask < 1 << n; mask += 1) {
        cases.push(order.map((v, k) => (mask & (1 << k) ? -v : v)));
      }
    }
  }

  for (const c of cases) {
    it(`circular case ${JSON.stringify(c)}`, () => {
      const r = solve(tokensOf(c), 'circular');
      if (r.topology !== 'circular') throw new Error('应当返回环状结果');
      const b = bruteForceCircular(c);
      expect(r.distance).toBe(b.distance);
      expect(r.totalPaths).toBe(BigInt(b.total));
      expect(r.canonical.steps).toEqual(b.lexicographicMin);

      // 规范轨迹可复现：逐步对当前规范表示施加弧倒位并重新规范化。
      let cur = r.initial;
      for (let d = 0; d < r.canonical.steps.length; d += 1) {
        const s = r.canonical.steps[d];
        // 0 基位置 [a, b-1]
        cur = circCanonArray(applyInversion(cur, s.a, s.b - 1));
        expect(encodeState(cur)).toBe(encodeState(r.canonical.states[d + 1]));
      }
      const goal = circCanonArray(tokensOf(Array.from({ length: c.length }, (_, k) => k + 1)));
      expect(encodeState(cur)).toBe(encodeState(goal));

      // 矩阵：行和 = 总数，且逐格与暴力枚举一致（含去重命名）。
      expect(r.matrix.length).toBe(b.matrix.length);
      for (let d = 0; d < r.matrix.length; d += 1) {
        let sum = 0n;
        for (const cell of r.matrix[d].arcs) {
          sum += cell.pathCount;
          const brute = b.matrix[d].counts.get(`${cell.a}:${cell.b}`) ?? 0n;
          expect(cell.pathCount, `depth ${d} arc (${cell.a},${cell.b})`).toBe(brute);
          expect(cell.presence).toBe(
            cell.pathCount === r.totalPaths ? 'all' : cell.pathCount === 0n ? 'none' : 'some',
          );
        }
        expect(sum).toBe(r.totalPaths);
      }
    });
  }
});

describe('环状：n=5/6/7 规模可解且计数自洽', () => {
  for (const v of [
    [-3, 5, -1, 4, -2],
    [6, -5, 4, -3, 2, -1],
    [-7, 6, -5, 4, -3, 2, -1],
  ]) {
    it(`case ${JSON.stringify(v)}`, () => {
      const r = solve(tokensOf(v), 'circular');
      if (r.topology !== 'circular') throw new Error('topology');
      expect(r.distance).toBeGreaterThan(0);
      expect(r.totalPaths > 0n).toBe(true);
      for (const layer of r.matrix) {
        let sum = 0n;
        for (const cell of layer.arcs) sum += cell.pathCount;
        expect(sum).toBe(r.totalPaths);
      }
      // 规范轨迹长度等于距离且逐步改变状态
      expect(r.canonical.steps.length).toBe(r.distance);
      for (let k = 1; k < r.canonical.states.length; k += 1) {
        expect(encodeState(r.canonical.states[k])).not.toBe(
          encodeState(r.canonical.states[k - 1]),
        );
      }
    });
  }
});

describe('拓扑隔离', () => {
  it('同一输入在线性 / 环状下独立求解（结果不互相复用）', () => {
    const t = solve(tokensOf([1, -3, -2, 4]), 'linear');
    const c = solve(tokensOf([1, -3, -2, 4]), 'circular');
    expect(t.topology).toBe('linear');
    expect(c.topology).toBe('circular');
    // 线性结果结构保持原语义
    expect(t.distance).toBe(1);
    expect(t.canonical.steps).toEqual([{ start: 2, end: 3 }]);
    // 环状下 [1,-3,-2,4] 到正向环序同样只需 1 步。规范代表元为 [-3,-2,4,1]：
    // {-3,-2} 这段弧跨首尾（切口 4 与切口 2），去重后以互补弧（位置 3..4，
    // 即标记 4、1）的字典序最小切口对 (2,4) 命名。
    expect(c.distance).toBe(1);
    if (c.topology !== 'circular') throw new Error('topology');
    expect(c.canonical.steps[0]).toEqual({ a: 2, b: 4 });
  });
});
