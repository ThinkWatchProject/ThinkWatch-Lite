import * as React from "react";
import { EyeIcon, EyeOffIcon } from "lucide-react";
import { useText } from "@/i18n";
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "@/ui/input-group";
import { uiText } from "./ui.i18n";

/**
 * 密钥、密码的输入框：值原样回填，默认隐藏，右侧的眼睛切换显示。
 *
 * `revealed` 给了就是受控的：同一个值在别处也显示时（上游表单请求头的第一行），
 * 两处跟着同一个开关。`plain` 的值不是秘密（`${变量名}`），明文显示、不给开关 ——
 * 输入框本身不换，打字时不会丢焦点。
 */
export function SecretInput({
  revealed,
  onRevealedChange,
  plain = false,
  ...props
}: Omit<React.ComponentProps<"input">, "type"> & {
  revealed?: boolean;
  onRevealedChange?: (revealed: boolean) => void;
  plain?: boolean;
}) {
  const t = useText(uiText);
  const [own, setOwn] = React.useState(false);
  const shown = revealed ?? own;

  function toggle() {
    setOwn(!shown);
    onRevealedChange?.(!shown);
  }

  return (
    <InputGroup>
      <InputGroupInput
        type={plain || shown ? "text" : "password"}
        autoComplete="off"
        spellCheck={false}
        {...props}
      />
      {!plain && (
        <InputGroupAddon align="inline-end">
          <InputGroupButton
            size="icon-xs"
            aria-label={shown ? t.hide : t.show}
            aria-pressed={shown}
            // 焦点留在输入框里：切换之后接着打字
            onMouseDown={(e) => e.preventDefault()}
            onClick={toggle}
          >
            {shown ? <EyeOffIcon /> : <EyeIcon />}
          </InputGroupButton>
        </InputGroupAddon>
      )}
    </InputGroup>
  );
}
