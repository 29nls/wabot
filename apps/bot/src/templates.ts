export interface TemplateVars {
  mention?: string;
  name?: string;
  group?: string;
  memberCount?: number | string;
  date?: string;
  rules?: string;
}

const ALIASES: Record<string, keyof TemplateVars> = {
  nama: 'name',
  grup: 'group',
  tanggal: 'date'
};

export function renderTemplate(template: string, vars: TemplateVars = {}): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) => {
    const canonical = (ALIASES[key] ?? key) as keyof TemplateVars;
    const value = vars[canonical];
    if (value === undefined || value === null) return match;
    return String(value);
  });
}