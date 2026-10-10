import { messages } from "@/i18n";

export const presetsText = messages(
  {
    custom: "自定义",
    desc: {
      anthropic: "Claude 系列模型",
      openai: "GPT 系列模型",
      gemini: "Gemini 系列模型",
      deepseek: "DeepSeek 系列模型",
      zai: "GLM 系列模型",
      bedrock: "AWS 上托管的多家模型",
      openrouter: "多家模型的聚合平台",
      thinkwatch: "ThinkWatch 企业网关",
      relay: "API 中转平台",
      ollama: "本机运行的开源模型",
      custom: "任何兼容接口的服务",
    },
    /** 搜索时还认的叫法 */
    aliases: {
      deepseek: ["深度求索"],
      zai: ["智谱"],
      thinkwatch: ["企业网关"],
      sub2api: ["中转"],
      newapi: ["中转"],
      ollama: ["本地"],
    },
  },
  {
    custom: "Custom",
    desc: {
      anthropic: "Claude models",
      openai: "GPT models",
      gemini: "Gemini models",
      deepseek: "DeepSeek models",
      zai: "GLM models",
      bedrock: "Many vendors' models on AWS",
      openrouter: "Many vendors behind one API",
      thinkwatch: "ThinkWatch enterprise gateway",
      relay: "API relay platform",
      ollama: "Open models running on this computer",
      custom: "Any service with a compatible API",
    },
    aliases: {
      deepseek: [],
      zai: [],
      thinkwatch: [],
      sub2api: [],
      newapi: [],
      ollama: [],
    },
  },
);
