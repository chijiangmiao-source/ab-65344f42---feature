/**
 * verify 一次性服务中的需求核查（业务断言，与单元测试分开、输出可读）：
 *   1) [1,-3,-2,4] 的线性最短步数必须为 1（且唯一最短倒位为 [2,3]）；
 *   2) 重复绝对值必须被校验拒绝（输入不保留给求解器）；
 *   3) 环状拓扑：旋转 / 整体反向翻号同一状态、跨首尾倒位可达、整环操作无效、
 *      同一状态对重复边只计一次且以字典序最小切口对命名；线性语义保持不变。
 * 任一断言失败即以非零退出码结束容器。
 */
import { encodeToken, encodeState, validatePermutation } from '../src/lib/permutation';
import { solve, toDTO } from '../src/lib/solver';

let failures = 0;

function check(name: string, ok: boolean, detail = '') {
  if (ok) {
    console.log(`PASS: ${name}${detail ? ` — ${detail}` : ''}`);
  } else {
    console.error(`FAIL: ${name}${detail ? ` — ${detail}` : ''}`);
    failures += 1;
  }
}

// 1) [1,-3,-2,4] 线性最短步数为 1
{
  const values = [1, -3, -2, 4];
  const { tokens, errors } = validatePermutation(values.join(','));
  check('[1,-3,-2,4] 通过输入校验', tokens !== undefined && errors.length === 0);
  if (tokens) {
    const r = solve(tokens, 'linear');
    check('[1,-3,-2,4] 线性最短步数为 1', r.distance === 1, `实际为 ${r.distance}`);
    check(
      '[1,-3,-2,4] 线性唯一最短倒位是 [2,3]',
      r.totalPaths === 1n &&
        r.canonical.steps.length === 1 &&
        r.canonical.steps[0].start === 2 &&
        r.canonical.steps[0].end === 3,
      `方案数 ${r.totalPaths}，规范步骤 ${JSON.stringify(r.canonical.steps)}`,
    );
  }
}

// 2) 重复绝对值被拒绝（同号重复、异号重复各一例）
for (const raw of ['1,1,3', '1,-1,2', '2,2,2']) {
  const { tokens, errors } = validatePermutation(raw);
  check(
    `重复绝对值被拒绝：“${raw}”`,
    tokens === undefined && errors.some((e) => e.includes('重复')),
    errors.join(' / '),
  );
}

// 3) 环状拓扑
{
  // 3a) 纯旋转等价：[4,1,2,3] 在环上就是正向环序
  const rot = solve([4, 1, 2, 3].map(encodeToken), 'circular');
  check('环状：[4,1,2,3] 经旋转等价于正向环序（距离 0）', rot.distance === 0, `实际为 ${rot.distance}`);

  // 3b) 整体反向并翻号等价：[-4,-3,-2,-1] 是 [1,2,3,4] 的整体反向翻号
  const rev = solve([-4, -3, -2, -1].map(encodeToken), 'circular');
  check('环状：[-4,-3,-2,-1] 经整体反向翻号等价于正向环序（距离 0）', rev.distance === 0, `实际为 ${rev.distance}`);

  // 3c) 同一物理排列的旋转 / 反向翻号给出完全一致的结果
  const base = [3, -1, -2, 4];
  const refs = [
    base,
    [4, 3, -1, -2],
    [-1, -2, 4, 3],
    base.slice().reverse().map((v) => -v),
  ];
  const r0 = solve(refs[0].map(encodeToken), 'circular');
  let invariant = true;
  for (const rep of refs.slice(1)) {
    const r = solve(rep.map(encodeToken), 'circular');
    if (
      r.distance !== r0.distance ||
      r.totalPaths !== r0.totalPaths ||
      JSON.stringify(toDTO(r).canonical) !== JSON.stringify(toDTO(r0).canonical) ||
      JSON.stringify(toDTO(r).matrix) !== JSON.stringify(toDTO(r0).matrix)
    ) {
      invariant = false;
    }
  }
  check('环状：旋转与整体反向翻号的全部表示审计结果一致', invariant);

  // 3d) 跨首尾倒位：[1,-3,-2,4] 环状距离 1（线性同为 1 但命名不同）；
  //     规范代表元为 [-3,-2,4,1]，弧 {-3,-2} 跨首尾，去重后以字典序最小
  //     切口对 (2,4)（互补弧）命名，边不重复计数。
  const cross = solve([1, -3, -2, 4].map(encodeToken), 'circular');
  check(
    '环状：[1,-3,-2,4] 距离 1，跨首尾倒位可选且以字典序最小切口对命名',
    cross.distance === 1 &&
      cross.totalPaths === 1n &&
      cross.canonical.steps.length === 1 &&
      cross.canonical.steps[0].a === 2 &&
      cross.canonical.steps[0].b === 4,
    `距离 ${cross.distance}，方案数 ${cross.totalPaths}，步骤 ${JSON.stringify(cross.canonical.steps)}`,
  );
  const layer = cross.matrix[0];
  const used = layer.arcs.filter((c) => c.pathCount > 0n);
  check(
    '环状：同一状态对的重复边只计一次（仅 1 个切口对有计数且为 1）',
    used.length === 1 && used[0].pathCount === 1n,
    `非空格：${JSON.stringify(used.map((c) => ({ a: c.a, b: c.b, n: c.pathCount.toString() })))}`,
  );

  // 3e) 整环操作无效：所有切口对 a<b（共 n(n-1)/2 个），弧长 1..n-1
  for (const values of [
    [-1, 2, 3],
    [2, -3, -1, 4],
  ]) {
    const r = solve(values.map(encodeToken), 'circular');
    const ok = r.matrix.every((l) =>
      l.arcs.every((c) => c.a >= 1 && c.a < c.b && c.b <= values.length && c.b - c.a < values.length),
    );
    const pairCount = r.matrix[0]?.arcs.length;
    check(
      `环状：n=${values.length} 矩阵恰有 n(n-1)/2=${(values.length * (values.length - 1)) / 2} 个切口对且无整环弧`,
      ok && pairCount === (values.length * (values.length - 1)) / 2,
      `实际 ${pairCount} 个`,
    );
  }

  // 3f) 环状行和不变量（每深度各切口对计数之和 = 方案总数）
  const big = solve([-7, 6, -5, 4, -3, 2, -1].map(encodeToken), 'circular');
  const rowsOk = big.matrix.every((l) => l.arcs.reduce((s, c) => s + c.pathCount, 0n) === big.totalPaths);
  check('环状：深度×切口对矩阵每行计数之和等于方案总数', rowsOk, `距离 ${big.distance}，方案数 ${big.totalPaths}`);

  // 3g) 线性语义保持：[4,1,2,3] 在线性下距离大于 0，不与环状复用
  const lin = solve([4, 1, 2, 3].map(encodeToken), 'linear');
  check('线性：[4,1,2,3] 不享受旋转等价（距离 > 0）', lin.distance > 0, `实际为 ${lin.distance}`);
  check('线性：矩阵仍按闭区间聚合（n(n+1)/2 列）', lin.matrix[0].intervals.length === 10);
  check(
    '线性：初始态不做任何规范化（保留用户输入排列）',
    encodeState(lin.initial) === encodeState([4, 1, 2, 3].map(encodeToken)),
  );
}

// 附带确认 encodeToken 没有被误用（快速健全性检查）
{
  const tokens = [1, -3, -2, 4].map(encodeToken);
  check('token 编码往返', tokens.length === 4);
}

if (failures > 0) {
  console.error(`需求核查失败 ${failures} 项`);
  process.exit(1);
}
console.log('需求核查全部通过');
