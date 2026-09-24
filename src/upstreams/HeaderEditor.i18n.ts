import { messages } from "@/i18n";

export const headerEditorText = messages(
  {
    name: "请求头名称",
    namePlaceholder: "名称",
    valueOf: (name: string) => `请求头「${name}」的值`,
    value: "请求头的值",
    keepSaved: "已保存，留空即保持不变",
    valuePlaceholder: "值，或 ${变量名}",
    remove: "删除此请求头",
    add: "添加请求头",
    client: "网关密钥名称",
    accessToken: "Access Token",
  },
  {
    name: "Header name",
    namePlaceholder: "Name",
    valueOf: (name: string) => `Value of header “${name}”`,
    value: "Header value",
    keepSaved: "Saved; leave empty to keep",
    valuePlaceholder: "Value, or ${NAME}",
    remove: "Delete this header",
    add: "Add header",
    client: "Gateway key name",
    accessToken: "Access token",
  },
);
