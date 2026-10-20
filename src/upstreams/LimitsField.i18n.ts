import { messages } from "@/i18n";

export const limitsFieldText = messages(
  {
    hint: "任一上限用满后，此上游暂不接收新请求",
    free: "此上游不计费，费用按 0 计入，费用上限不会用满。",
  },
  {
    hint: "Once any limit is used up, this upstream takes no new requests for a while",
    free: "This upstream is free: its cost counts as $0, so a cost limit is never used up.",
  },
);
