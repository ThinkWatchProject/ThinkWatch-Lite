import type { Lang } from "@/i18n";

// ISO 639-1 and ISO 3166-1 identifiers are storage values only. DisplayNames
// supplies readable names in the UI language; the combobox searches those names.
const LANGUAGES = "aa ab ae af ak am an ar as av ay az ba be bg bh bi bm bn bo br bs ca ce ch co cr cs cu cv cy da de dv dz ee el en eo es et eu fa ff fi fj fo fr fy ga gd gl gn gu gv ha he hi ho hr ht hu hy hz ia id ie ig ii ik io is it iu ja jv ka kg ki kj kk kl km kn ko kr ks ku kv kw ky la lb lg li ln lo lt lu lv mg mh mi mk ml mn mr ms mt my na nb nd ne ng nl nn no nr nv ny oc oj om or os pa pi pl ps pt qu rm rn ro ru rw sa sc sd se sg si sk sl sm sn so sq sr ss st su sv sw ta te tg th ti tk tl tn to tr ts tt tw ty ug uk ur uz ve vi vo wa wo xh yi yo za zh zh-Hans zh-Hant zu".split(" ");
const REGIONS = "AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW".split(" ");

export type LocaleOption = { value: string; label: string };
export type LocaleKind = "language" | "region";

export function localeName(kind: LocaleKind, code: string, lang: Lang): string | undefined {
  if (!code) return undefined;
  try {
    return new Intl.DisplayNames([lang], { type: kind, fallback: "none" }).of(code);
  } catch { return undefined; }
}

export function localeOptions(kind: LocaleKind, lang: Lang, current: string, automatic: string, unknown: string): LocaleOption[] {
  const codes = kind === "language" ? LANGUAGES : REGIONS;
  const options = [...new Set([...codes, ...(current ? [current] : [])])]
    .map((value) => ({ value, label: localeName(kind, value, lang) }))
    .filter((item): item is LocaleOption => !!item.label || item.value === current)
    .map((item) => ({ ...item, label: item.label || unknown }))
    .sort((a, b) => a.label.localeCompare(b.label, lang));
  return [{ value: "", label: automatic }, ...options];
}
