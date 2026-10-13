import {
  ResumeDrillSourceSchema,
  type ResumeDrillSourceInput,
} from "@techspar/contracts";
import type { ResumeData } from "../types/resume";
import { generateResumeMarkdown } from "../utils/markdown";
import { useResumeStore } from "../store/useResumeStore";
import { getFreshServerResume, getResumeAccount } from "../store/resumeAccount";

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

export async function assertResumeDrillSource(
  account: string | null,
  source: ResumeDrillSourceInput,
  selectedId: string,
): Promise<void> {
  if (!account || account !== getResumeAccount())
    throw new Error("登录账号已变化，请重新加载");
  const current = useResumeStore.getState().resumes[selectedId];
  if (!current || selectedId !== source.id)
    throw new Error("简历版本已变化，请重新生成考点");
  const actual = buildResumeDrillSource(current);
  if (actual.title !== source.title || actual.text !== source.text)
    throw new Error("简历内容已变化，请重新生成考点");
  const saved = await getFreshServerResume(selectedId) as ResumeData | undefined;
  if (!saved) throw new Error("服务器尚未保存这份简历，请等待保存完成后重试");
  const savedSource = buildResumeDrillSource(saved);
  if (savedSource.title !== source.title || savedSource.text !== source.text)
    throw new Error("其他窗口的简历内容已变化，请刷新后重新生成考点");
}
