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
  {
    "zh-Hant": {
      hint: "任一上限用滿後，此上游暫不接收新請求",
      free: "此上游不計費，費用按 0 計入，費用上限不會用滿。",
    },
    es: {
      hint: "Una vez que se ha agotado cualquier límite, este curso no toma nuevas solicitudes durante un tiempo",
      free: "Este curso previo es gratuito: su costo cuenta como $0, por lo que un límite de costo nunca se consume.",
    },
  },
);
