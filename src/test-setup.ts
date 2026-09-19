import { beforeEach } from "vitest";
import { setLang } from "./i18n";

/**
 * 测试默认按中文跑。
 *
 * 界面语言的初始值取自运行环境的语言，而测试会在各种机器上跑 —— CI 是英文的。
 * 断言大多写的是中文，所以每条测试开始前拨回中文；要测英文的测试自己切过去。
 */
beforeEach(() => setLang("zh"));
