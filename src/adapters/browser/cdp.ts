import { AGENT } from "../../config/agent.ts";
import {
  browserRuntimeSettings,
  type BrowserRuntimeSettings,
} from "../../config/browser-runtime.ts";
import { searchCities } from "../../config/job-filters.ts";
import { parseCompanySize } from "../../domain/ranker.ts";

// Reuse the visible browser's session. Credentials never leave Chromium.
export class BossTools {
  pending: Map<
    number,
    {
      timer: ReturnType<typeof setTimeout>;
      resolve: (value: any) => void;
      reject: (error: Error) => void;
    }
  >;
  sequence: number;
  ws: WebSocket;
  onEvent?: (message: any) => void;
  settings: BrowserRuntimeSettings;
  constructor() {
    this.settings = browserRuntimeSettings();
    this.pending = new Map();
    this.sequence = 0;
  }
  async connect(targetId?: string) {
    const targets = await fetch(
      AGENT.browser.cdpUrl.replace(/\/$/, "") + "/json/list",
      { signal: AbortSignal.timeout(this.settings.discoveryTimeoutMs) },
    ).then((r) => r.json());
    const target = targets.find((t) => {
      try {
        return (
          t.type === "page" &&
          (!targetId || t.id === targetId) &&
          new URL(t.url).origin === "https://www.zhipin.com"
        );
      } catch {
        return false;
      }
    });
    if (!target) throw new Error("请打开已登录的 BOSS 页面");
    this.ws = new WebSocket(target.webSocketDebuggerUrl);
    this.ws.onmessage = (e) => {
      const m = JSON.parse(e.data),
        p = this.pending.get(m.id);
      if (m.method && this.onEvent) this.onEvent(m);
      if (!p) return;
      clearTimeout(p.timer);
      this.pending.delete(m.id);
      m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result);
    };
    this.ws.onclose = () => {
      for (const p of this.pending.values()) {
        clearTimeout(p.timer);
        p.reject(new Error("浏览器连接已断开"));
      }
      this.pending.clear();
    };
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.ws.close();
        reject(new Error("CDP连接超时"));
      }, this.settings.connectTimeoutMs);
      this.ws.onopen = () => {
        clearTimeout(timer);
        resolve();
      };
      this.ws.onerror = () => {
        clearTimeout(timer);
        reject(new Error("CDP连接失败"));
      };
    });
  }
  call(method: string, params = {}): Promise<any> {
    if (this.ws?.readyState !== WebSocket.OPEN)
      return Promise.reject(new Error("CDP未连接"));
    return new Promise((resolve, reject) => {
      const id = ++this.sequence;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${method} 超时`));
      }, this.settings.commandTimeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  disconnect() {
    this.ws?.close();
  }
  async navigate(url) {
    const expected = new URL(url);
    if (expected.origin !== "https://www.zhipin.com")
      throw new Error("只允许BOSS页面导航");
    let timeout;
    try {
      await this.call("Page.navigate", { url });
    } catch (error) {
      if (!/超时/.test(error.message)) throw error;
      timeout = error;
    }
    // A timeout is not proof that navigation failed. Observe without navigating again.
    for (let attempt = 0; attempt < this.settings.navigationChecks; attempt++) {
      const r = await this.call("Runtime.evaluate", {
        expression:
          "({url:location.href,ready:document.readyState,hasBody:!!document.body})",
        returnByValue: true,
      }).catch(() => null);
      const page = r?.result?.value;
      if (page?.hasBody && ["interactive", "complete"].includes(page.ready)) {
        const actual = new URL(page.url);
        if (
          actual.origin === expected.origin &&
          actual.pathname === expected.pathname &&
          actual.search === expected.search
        )
          return { ready: true, recoveredFromTimeout: Boolean(timeout) };
        if (/verify|passport/.test(actual.pathname))
          throw new Error("导航进入登录或验证页，需要人工处理");
      }
      await new Promise((resolve) =>
        setTimeout(resolve, this.settings.navigationPollMs),
      );
    }
    throw new Error("目标页面未就绪，已停止；未重复导航");
  }
  async read(path, params = {}) {
    const allowed = [
      "/wapi/zpgeek/resume/geek/preview/data.json",
      "/wapi/zpgeek/search/joblist.json",
    ];
    if (!allowed.includes(path)) throw new Error("未验证的读取接口");
    const relative = path + "?" + new URLSearchParams(params);
    const expression = `(async()=>{
      if(location.origin!=='https://www.zhipin.com') throw new Error('页面来源变化');
      if(!document.body) throw new Error('页面尚未就绪：正文为空，暂停接口操作');
      if(/安全验证|异常访问|访问受限|请先登录/.test(document.body.innerText)) throw new Error('需要人工处理登录或验证');
      const r=await fetch(${JSON.stringify(relative)},{credentials:'same-origin',signal:AbortSignal.timeout(${this.settings.apiReadTimeoutMs})});
      if(!r.ok) throw new Error('HTTP '+r.status);
      const j=await r.json();
      if(j.code!==0) throw new Error('BOSS业务错误 '+j.code);
      return j.zpData;
    })()`;
    const r = await this.call("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (r.exceptionDetails)
      throw new Error(
        r.exceptionDetails.exception?.description || "接口读取失败",
      );
    return r.result.value;
  }
  async readResume() {
    const data = await this.read("/wapi/zpgeek/resume/geek/preview/data.json");
    // Exclude identity/contact fields; only professional information is returned.
    const result = {
      name: data.baseInfo?.name,
      experience: data.baseInfo?.workYearDesc,
      sections: {},
    };
    for (const [key, value] of Object.entries(data)) {
      if (
        /expect|work|project|education|eduExp|skill|advantage|description|geekDesc|userDesc/i.test(
          key,
        )
      )
        result.sections[key] = value;
    }
    return result;
  }
  async searchJobs({
    query,
    page = 1,
  }: { query?: string; page?: number } = {}) {
    if (!query || typeof query !== "string" || query.length > 80)
      throw new Error("请输入岗位关键词");
    if (!Number.isInteger(page) || page < 1 || page > 30)
      throw new Error("页码无效");
    const city = searchCities()[0];
    const data = await this.read("/wapi/zpgeek/search/joblist.json", {
      scene: "1",
      query,
      city: city.code,
      page: String(page),
      pageSize: "15",
    });
    if (!Array.isArray(data.jobList)) throw new Error("职位接口结构变化");
    const jobs = data.jobList.map((j) => ({
      id: j.encryptJobId,
      title: j.jobName,
      company: j.brandName,
      companySize: j.brandScaleName,
      location: [j.cityName, j.areaDistrict, j.businessDistrict]
        .filter(Boolean)
        .join("·"),
      salary: j.salaryDesc,
      experience: j.jobExperience,
      degree: j.jobDegree,
      skills: j.skills,
      contacted: j.contact === true,
      valid: j.jobValidStatus === 1,
      href: `https://www.zhipin.com/job_detail/${j.encryptJobId}.html`,
    }));
    const accepted = [],
      rejected = [];
    for (const job of jobs) {
      const size = parseCompanySize(job.companySize);
      const reason = !job.location.startsWith(city.name)
        ? "城市不匹配"
        : !size || size.minimum < AGENT.search.minimumCompanySize
          ? `企业不足${AGENT.search.minimumCompanySize}人或规模未知`
          : job.contacted
            ? "已经联系"
            : !job.valid
              ? "岗位无效"
              : null;
      (reason ? rejected : accepted).push(reason ? { ...job, reason } : job);
    }
    return { query, page, hasMore: data.hasMore, accepted, rejected };
  }
}

export const toolDefinitions = [
  {
    name: "read_resume",
    description: "读取当前账号的职业简历信息",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: "search_jobs",
    description:
      "搜索配置中的首个城市，按配置的企业规模下限剔除不合格、未知规模及已联系岗位",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string" },
        page: { type: "integer", minimum: 1, maximum: 30 },
      },
      required: ["query"],
      additionalProperties: false,
    },
  },
];
