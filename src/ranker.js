function normalized(value) {
  return String(value || "").toLocaleLowerCase("zh-CN");
}

export function parseMonthlySalaryK(value) {
  const text = String(value || "").replace(/\s/g, "");
  const match = text.match(/(\d+(?:\.\d+)?)\s*[-–—~至]\s*(\d+(?:\.\d+)?)\s*[kK]/);
  if (!match) return null;
  return { minimum: Number(match[1]), maximum: Number(match[2]) };
}

export function parseCompanySize(value) {
  const text = String(value || "").replace(/[\s,，]/g, "");
  let match = text.match(/^(\d+)[-–—~至](\d+)人$/);
  if (match) return Number(match[1]) <= Number(match[2]) ? { minimum: Number(match[1]), maximum: Number(match[2]) } : null;
  match = text.match(/^(\d+)人(?:以上|及以上)$/);
  if (match) return { minimum: Number(match[1]), maximum: Infinity };
  match = text.match(/^(?:少于|不足)(\d+)人$/);
  if (match) return { minimum: 0, maximum: Math.max(0, Number(match[1]) - 1) };
  match = text.match(/^(\d+)人$/);
  if (match) return { minimum: Number(match[1]), maximum: Number(match[1]) };
  return null;
}

export function ruleEvaluate(job, config) {
  const criteria = config.criteria;
  const searchable = normalized([job.title, job.company, job.location, job.summary, job.description].join("\n"));
  const reasons = [];
  const risks = [];
  let score = 50;

  const excluded = criteria.excludeKeywords.find((term) => searchable.includes(normalized(term)));
  if (excluded) return { eligible: false, score: 0, reasons, risks: [`命中排除词：${excluded}`] };

  if (criteria.targetTitles.length) {
    const match = criteria.targetTitles.find((term) => normalized(job.title).includes(normalized(term)));
    if (match) {
      score += 20;
      reasons.push(`职位名称匹配：${match}`);
    } else {
      score -= 20;
      risks.push("职位名称未匹配目标岗位");
    }
  }

  const missingRequired = criteria.requiredKeywords.filter((term) => !searchable.includes(normalized(term)));
  if (missingRequired.length) {
    score -= Math.min(30, missingRequired.length * 10);
    risks.push(`缺少关键词：${missingRequired.join("、")}`);
  } else if (criteria.requiredKeywords.length) {
    score += 15;
    reasons.push("满足必需关键词");
  }

  if (criteria.cities.length) {
    const city = criteria.cities.find((item) => normalized(job.location).includes(normalized(item)));
    if (city) {
      score += 10;
      reasons.push(`城市匹配：${city}`);
    } else {
      return { eligible: false, score: 0, reasons, risks: ["城市不匹配"] };
    }
  }

  if (criteria.minimumCompanySize > 0) {
    const companySize = parseCompanySize(job.companySize);
    if (!companySize) {
      return { eligible: false, score: 0, reasons, risks: ["企业规模未知"] };
    }
    if (companySize.minimum < criteria.minimumCompanySize) {
      return {
        eligible: false,
        score: 0,
        reasons,
        risks: [`企业规模不足 ${criteria.minimumCompanySize} 人`],
      };
    }
    score += 10;
    reasons.push(`企业规模不少于 ${criteria.minimumCompanySize} 人`);
  }

  const salary = parseMonthlySalaryK(job.salary);
  if (criteria.minimumMonthlySalaryK > 0 && salary) {
    if (salary.maximum < criteria.minimumMonthlySalaryK) {
      score -= 30;
      risks.push("薪资上限低于期望");
    } else {
      score += 10;
      reasons.push("薪资范围满足期望");
    }
  }

  score = Math.max(0, Math.min(100, score));
  return { eligible: score > 0, score, reasons, risks };
}
