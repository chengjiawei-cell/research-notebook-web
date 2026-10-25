export const collections = ['groups', 'projects', 'tasks', 'events', 'milestones', 'notes', 'papers', 'files'];
const fail = message => { throw Object.assign(new Error(message), { status: 400 }); };
const text = (value, max = 500) => typeof value === 'string' && value.length <= max;
const idPattern = /^[a-zA-Z0-9_-]{1,100}$/;
const datePattern = /^\d{4}-\d{2}-\d{2}$/;
export function validDate(value) {
  if (!text(value, 10) || !datePattern.test(value)) return false;
  const d = new Date(value + 'T00:00:00Z');
  return !Number.isNaN(+d) && d.toISOString().slice(0, 10) === value;
}
export function validate(data) {
  if (!data || data.version !== 1 || !data.profile || !text(data.profile.name, 100) || !text(data.profile.goal, 1000)) fail('工作区格式或个人信息不正确。');
  for (const key of ['university', 'major']) if (!text(data.profile[key] ?? '', 200)) fail('个人信息过长。');
  const ids = new Set();
  for (const key of collections) {
    if (!Array.isArray(data[key]) || data[key].length > 20000) fail(`无效的数据集合：${key}`);
    for (const item of data[key]) {
      if (!item || !idPattern.test(item.id) || ids.has(item.id)) fail('记录编号无效或重复。');
      ids.add(item.id);
      if (!text(item.title ?? item.name, 300) || !(item.title ?? item.name).trim()) fail('名称不能为空，且不能超过 300 字。');
      for (const value of Object.values(item)) if (typeof value === 'string' && value.length > 100000) fail('单条内容不能超过十万字。');
    }
  }
  const groups = new Set(data.groups.map(x => x.id));
  const projects = new Map(data.projects.map(x => [x.id, x]));
  for (const key of collections.filter(k => k !== 'groups')) {
    for (const item of data[key]) {
      if (!groups.has(item.groupId)) fail('记录必须属于现有课题组。');
      if (item.projectId && (!projects.has(item.projectId) || projects.get(item.projectId).groupId !== item.groupId)) fail('项目与课题组不匹配。');
      for (const field of ['date', 'due', 'start', 'end']) if (item[field] && !validDate(item[field])) fail('请填写有效日期。');
    }
  }
  for (const item of data.projects) {
    if (!['active', 'paused', 'completed'].includes(item.status)) fail('无效的项目状态。');
    if (item.start && item.due && item.due < item.start) fail('项目截止日期不能早于开始日期。');
  }
  for (const item of data.tasks) if (!['todo', 'doing', 'done'].includes(item.status) || !['low', 'normal', 'high'].includes(item.priority)) fail('无效的任务状态或优先级。');
  for (const item of data.events) {
    if (!validDate(item.date) || !/^\d{2}:\d{2}$/.test(item.time) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(item.time)) fail('日程日期或时间无效。');
  }
  for (const item of data.notes) if (!validDate(item.date) || !Number.isFinite(item.hours) || item.hours < 0 || item.hours > 24) fail('日志日期或科研时长无效（0–24 小时）。');
  for (const item of data.milestones) if (!validDate(item.date)) fail('里程碑日期无效。');
  for (const item of data.papers) {
    if (!['unread', 'reading', 'read'].includes(item.status)) fail('无效的阅读状态。');
    if (item.url) { try { if (!['https:', 'http:'].includes(new URL(item.url).protocol)) fail('文献链接须以 https:// 或 http:// 开头。'); } catch { fail('文献链接无效。'); } }
    if (item.pdfUrl) { try { if (new URL(item.pdfUrl).protocol !== 'https:') fail('PDF 直链须使用 HTTPS。'); } catch { fail('PDF 直链无效，请使用 HTTPS 链接。'); } }
    if (item.readingNotes !== undefined && !text(item.readingNotes, 100000)) fail('阅读笔记必须为文本，且不能超过十万字。');
    if (item.readingPage !== undefined && (!Number.isInteger(item.readingPage) || item.readingPage < 1 || item.readingPage > 100000)) fail('阅读页码无效。');
    if (item.pdfFileId && !data.files.some(file=>file.id===item.pdfFileId&&file.groupId===item.groupId)) fail('关联的 PDF 资料不存在，或不属于这篇文献的课题组。');
  }
  for (const item of data.files) {
    if (!new RegExp(`^materials/${item.groupId}/[a-zA-Z0-9_.-]+$`).test(item.path) || item.path.includes('..') || !Number.isInteger(item.size) || item.size < 0) fail('资料路径或大小无效。');
  }
  return data;
}
