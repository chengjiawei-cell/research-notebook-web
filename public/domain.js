export const day = (date = new Date()) => { const offset = date.getTimezoneOffset(); return new Date(+date - offset * 60000).toISOString().slice(0, 10); };
export const shiftDay = (date, n) => { const d = new Date(date + 'T12:00:00'); d.setDate(d.getDate() + n); return day(d); };
export const groupColors = ['sage', 'blue', 'amber', 'rose', 'violet'];
export const statusNames = { active:'进行中', paused:'已暂停', completed:'已结题', todo:'待开始', doing:'进行中', done:'已完成', unread:'待读', reading:'在读', read:'已读' };
export const priorityNames = { low:'低优先级', normal:'普通', high:'高优先级' };
export function progress(data, project) { const tasks = data.tasks.filter(t => t.projectId === project.id); return tasks.length ? Math.round(tasks.filter(t => t.status === 'done').length / tasks.length * 100) : project.status === 'completed' ? 100 : 0; }
export function scoped(data, key, groupId = 'all', query = '') {
  const q = query.trim().toLowerCase();
  return data[key].filter(item => (groupId === 'all' || (key === 'groups' ? item.id : item.groupId) === groupId) && (!q || [item.title, item.name, item.content, item.summary, item.readingNotes, item.author, item.tags, item.description, item.next, item.blockers, item.mentor].some(v => String(v || '').toLowerCase().includes(q))));
}
export function weekRange(date = day()) { const d = new Date(date + 'T12:00:00'); const start = shiftDay(date, -((d.getDay() + 6) % 7)); return { start, end: shiftDay(start, 6) }; }
export function report(data, groupId = 'all', date = day()) {
  const { start, end } = weekRange(date); const rows = key => scoped(data, key, groupId); const inWeek = x => x.date >= start && x.date <= end;
  const notes = rows('notes').filter(inWeek); const tasks = rows('tasks').filter(t => t.status === 'done' && inWeek({ date:t.completedAt }));
  const events = rows('events').filter(inWeek); const milestones = rows('milestones').filter(inWeek);
  const list = items => items.length ? items.map(x => `- ${x}`).join('\n') : '- 暂无记录';
  const hours = notes.reduce((sum, n) => sum + n.hours, 0);
  return `# 科研周报\n\n${start} — ${end}\n\n姓名：${data.profile.name || '未填写'}\n科研投入：${hours.toFixed(1)} 小时\n\n## 本周完成\n${list(tasks.map(t => t.title))}\n\n## 实验与研究记录\n${list(notes.map(n => `${n.date} · ${n.title}\n  ${n.content || ''}`))}\n\n## 关键里程碑\n${list(milestones.map(m => `${m.date} · ${m.title}`))}\n\n## 会议与日程\n${list(events.map(e => `${e.date} ${e.time} · ${e.title}`))}\n\n## 遇到的问题\n${list(notes.filter(n => n.blockers).map(n => n.blockers))}\n\n## 下一步计划\n${list([...notes.filter(n => n.next).map(n => n.next), ...rows('tasks').filter(t => t.status !== 'done').map(t => `${t.title}${t.due ? `（截止 ${t.due}）` : ''}`)])}\n`;
}
export function makeDemo() {
  const date = day(); const at = n => shiftDay(date, n);
  const data = { version:1, profile:{ name:'同学', university:'大学科研 · 演示工作区', major:'', goal:'在问题中寻找方向，在记录中看见成长。' }, groups:[],projects:[],tasks:[],events:[],milestones:[],notes:[],papers:[],files:[] };
  data.groups = [
    {id:'g-vision',name:'智能视觉实验室',mentor:'陈老师（示例）',direction:'计算机视觉 / 低光照图像增强',role:'本科生科研助理',joined:at(-120),description:'探索视觉感知与智能成像，让机器看清更复杂的世界。',color:'sage',meeting:'每周三 14:30 · 实验楼 302'},
    {id:'g-computing',name:'计算物理研究组',mentor:'李老师（示例）',direction:'物理信息神经网络 / 非线性动力学',role:'项目成员',joined:at(-90),description:'结合数值模拟与深度学习，研究复杂系统中的物理规律。',color:'blue',meeting:'每周五 16:00 · 线上会议'},
    {id:'g-systems',name:'智能系统创新小组',mentor:'周老师（示例）',direction:'嵌入式系统 / 物联网',role:'学生负责人',joined:at(-50),description:'从一个想法出发，把软硬件结合成可以触摸的作品。',color:'amber',meeting:'每周日 19:00 · 创客空间'}
  ];
  data.projects = [
    {id:'p-light',groupId:'g-vision',title:'面向移动端的低光照图像增强',description:'在有限算力下，平衡图像质量与实时推理效率。',status:'active',start:at(-70),due:at(25),stage:'对比实验',tags:'图像增强, 深度学习'},
    {id:'p-pinn',groupId:'g-computing',title:'基于 PINN 的非线性波求解',description:'使用物理信息神经网络近似求解非线性偏微分方程。',status:'active',start:at(-45),due:at(40),stage:'模型构建',tags:'PINN, 数值模拟'},
    {id:'p-epd',groupId:'g-systems',title:'低功耗桌面环境感知终端',description:'从传感采集到墨水屏显示的完整系统设计。',status:'active',start:at(-30),due:at(15),stage:'原型验证',tags:'ESP32, 物联网'}
  ];
  const taskSeeds = [ ['p-light','g-vision','整理对比实验结果','doing',1,'high'],['p-light','g-vision','补充消融实验','todo',4,'normal'],['p-light','g-vision','完成基线复现','done',-10,'normal'],['p-light','g-vision','清洗训练数据','done',-7,'normal'],['p-light','g-vision','建立评估指标','done',-2,'normal'],['p-pinn','g-computing','检查边界条件与损失函数','doing',2,'high'],['p-pinn','g-computing','复现原始网络结构','done',-3,'normal'],['p-pinn','g-computing','比较不同采样策略','todo',7,'normal'],['p-epd','g-systems','测试设备深度休眠功耗','todo',3,'normal'],['p-epd','g-systems','传感器驱动联调','done',-1,'normal'] ];
  data.tasks=taskSeeds.map((t,i)=>({id:`t-${i}`,projectId:t[0],groupId:t[1],title:t[2],status:t[3],due:at(t[4]),priority:t[5],completedAt:t[3]==='done'?at(t[4]):''}));
  data.events=[{id:'e-1',groupId:'g-vision',projectId:'p-light',title:'视觉组 · 每周进展讨论',date,time:'14:30',type:'组会',location:'实验楼 302',description:'准备实验对比图与本周问题清单。'},{id:'e-2',groupId:'g-computing',title:'PINN 文献精读与分享',date:at(2),time:'16:00',type:'文献分享',location:'线上会议',description:''},{id:'e-3',groupId:'g-systems',title:'原型功耗测试',date:at(3),time:'09:30',type:'实验',location:'创客空间',description:''},{id:'e-4',groupId:'g-vision',title:'提交阶段研究报告',date:at(6),time:'18:00',type:'截止日期',location:'',description:''}];
  data.milestones=[{id:'m-1',groupId:'g-vision',projectId:'p-light',title:'第一次复现，跑通完整训练流程',date:at(-48),type:'阶段成果',description:'从读懂代码到独立训练，完成了第一个小闭环。'},{id:'m-2',groupId:'g-computing',projectId:'p-pinn',title:'加入计算物理研究组',date:at(-90),type:'加入课题组',description:'开始探索机器学习与物理模型的交叉问题。'},{id:'m-3',groupId:'g-vision',projectId:'p-light',title:'完成第一轮对比实验',date:at(-2),type:'实验突破',description:'形成统一的数据处理与模型评估流程。'}];
  data.notes=[{id:'n-1',groupId:'g-vision',projectId:'p-light',title:'低光增强：第一轮实验复盘',date,hours:2.5,content:'在统一测试集上完成首轮评估。暗部细节有改善，下一轮重点关注颜色一致性。',blockers:'高噪声区域仍存在伪影，需要检查损失项权重。',next:'补充噪声分级测试并整理可视化结果。'},{id:'n-2',groupId:'g-computing',projectId:'p-pinn',title:'边界条件与采样策略笔记',date:at(-1),hours:3,content:'对比均匀采样与自适应采样，记录训练收敛情况。',blockers:'',next:'检查不同随机种子下的稳定性。'},{id:'n-3',groupId:'g-systems',projectId:'p-epd',title:'原型联调记录',date:at(-3),hours:1.5,content:'打通传感器采集、数据处理和屏幕刷新。',blockers:'',next:'测量休眠与唤醒阶段的电流。'}];
  for(let i=1;i<=60;i++)if(i%4!==0&&i%7!==0)data.notes.push({id:`n-history-${i}`,groupId:i%2?'g-vision':'g-computing',title:'日常研究记录（示例）',date:at(-i-4),hours:[1,1.5,2,3][i%4],content:'文献阅读、实验调试与阶段思考。',blockers:'',next:''});
  data.papers=[{id:'r-1',groupId:'g-computing',projectId:'p-pinn',title:'Physics-informed neural networks',author:'Raissi et al.',year:'2019',url:'https://doi.org/10.1016/j.jcp.2018.10.045',status:'reading',summary:'通过物理方程残差约束网络训练。',tags:'PINN, 方法基础'},{id:'r-2',groupId:'g-vision',projectId:'p-light',title:'Learning to See in the Dark',author:'Chen et al.',year:'2018',url:'https://arxiv.org/abs/1805.01934',status:'read',summary:'端到端处理极低光照 RAW 图像。',tags:'低光照, RAW'}];
  return data;
}
