import {
  ResumeDrillSourceSchema,
  type ResumeDrillSourceInput,
} from "@techspar/contracts";
import type { ResumeData } from "../types/resume";
import { generateResumeMarkdown } from "../utils/markdown";
import { useResumeStore } from "../store/useResumeStore";
import { getResumeAccount } from "../store/resumeAccount";

// Reuse the editor's visible-section serializer; contact details and images
// are not needed for a learning outline and are not sent to the model.
export function buildResumeDrillSource(
  resume: ResumeData,
): ResumeDrillSourceInput {
  const data = {
    ...resume,
    menuSections: resume.menuSections.filter(
      (section) => !["basic", "certificates"].includes(section.id),
    ),
  };
  const result = ResumeDrillSourceSchema.safeParse({
    id: resume.id,
    title: resume.title,
    text: generateResumeMarkdown(data, { strictSections: true })
      .split("\n")
      .slice(1)
      .join("\n")
      .trim(),
  });
  if (!result.success)
    throw new Error(
      "简历标题需 1-200 字，可见文字正文需 40-20000 字，请先补充或精简简历",
    );
  return result.data;
}

export function assertResumeDrillSource(
  account: string | null,
  source: ResumeDrillSourceInput,
  selectedId: string,
): void {
  if (!account || account !== getResumeAccount())
    throw new Error("登录账号已变化，请重新加载");
  const current = useResumeStore.getState().resumes[selectedId];
  if (!current || selectedId !== source.id)
    throw new Error("简历版本已变化，请重新生成考点");
  const actual = buildResumeDrillSource(current);
  if (actual.title !== source.title || actual.text !== source.text)
    throw new Error("简历内容已变化，请重新生成考点");
  const raw = localStorage.getItem(
    `resume-storage:${encodeURIComponent(account)}`,
  );
  if (!raw) throw new Error("无法确认已保存的简历，请先备份并刷新页面");
  let persisted;
  try {
    persisted = JSON.parse(raw);
  } catch {
    throw new Error("已保存的简历数据损坏，请先备份浏览器数据");
  }
  const saved = persisted?.state?.resumes?.[selectedId] as
    | ResumeData
    | undefined;
  if (!saved) throw new Error("其他窗口的简历版本已变化，请刷新后重新生成考点");
  const savedSource = buildResumeDrillSource(saved);
  if (savedSource.title !== source.title || savedSource.text !== source.text)
    throw new Error("其他窗口的简历内容已变化，请刷新后重新生成考点");
}
