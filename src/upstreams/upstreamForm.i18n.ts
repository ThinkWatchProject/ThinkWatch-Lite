import { messages } from "@/i18n";

export const upstreamFormText = messages(
  {
    name: "填写名称",
    nameTaken: (name: string) => `名称「${name}」已被其他上游使用`,
    baseUrl: "填写接口地址",
    oauth: "填写 Refresh Token 与 Token 端点",
    headerName: "填写请求头名称",
    headerValue: (header: string) => `填写请求头「${header}」的值`,
    pickModel: "至少选择一个模型",
    found: (n: number) => `发现 ${n} 个模型`,
    notImplemented: (status: number) => `上游未提供模型列表接口（HTTP ${status}）`,
    unrecognized: "模型列表格式无法识别",
    empty: "模型列表为空",
  },
  {
    name: "Enter a name",
    nameTaken: (name: string) => `The name “${name}” is already used by another upstream`,
    baseUrl: "Enter the base URL",
    oauth: "Enter the refresh token and token endpoint",
    headerName: "Enter a header name",
    headerValue: (header: string) => `Enter a value for header “${header}”`,
    pickModel: "Select at least one model",
    found: (n: number) => (n === 1 ? "1 model found" : `${n} models found`),
    notImplemented: (status: number) => `No model list endpoint (HTTP ${status})`,
    unrecognized: "Model list format not recognized",
    empty: "Model list is empty",
  },
);
