export type SkillFrontmatter = {
  name: string;
  description: string;
  license?: string;
  compatibility?: string;
  metadata?: Record<string, string>;
  allowedTools?: string;
};

export type SkillRecord = {
  name: string;
  description: string;
  body: string;
  location: string;
  dirName: string;
  frontmatter: SkillFrontmatter;
};

export type SkillDiagnostic = {
  level: "error" | "warn";
  path: string;
  message: string;
};
