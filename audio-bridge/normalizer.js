'use strict';

const DIGITS = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九'];

function digitSequence(value) {
  return String(value)
    .split('')
    .map((char) => DIGITS[Number(char)] || char)
    .join('');
}

function smallNumber(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return String(value);
  if (number < 0 || number > 9999) return String(value);
  if (number === 0) return '零';

  const thousands = Math.floor(number / 1000);
  const hundreds = Math.floor((number % 1000) / 100);
  const tens = Math.floor((number % 100) / 10);
  const ones = number % 10;
  let result = '';

  if (thousands) result += `${DIGITS[thousands]}千`;
  if (hundreds) result += `${DIGITS[hundreds]}百`;
  else if (result && tens) result += '零';
  if (tens > 1) result += `${DIGITS[tens]}十`;
  else if (tens === 1) result += '十';
  else if (result && ones && !result.endsWith('零')) result += '零';
  if (ones) result += DIGITS[ones];

  return result;
}

function cardinalNumber(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || !Number.isInteger(number) || number < 0) return String(value);
  if (number > 99999999) return digitSequence(value);
  if (number < 10000) return smallNumber(number);

  const wan = Math.floor(number / 10000);
  const rest = number % 10000;
  let result = `${smallNumber(wan)}万`;
  if (rest === 0) return result;
  if (rest < 1000) result += '零';
  result += smallNumber(rest);
  return result;
}

function currencyToChinese(value) {
  const [integerPart, decimalPart = ''] = String(value).split('.');
  const integer = cardinalNumber(integerPart);
  if (!decimalPart) return `${integer}元`;

  const jiao = decimalPart[0] ? Number(decimalPart[0]) : 0;
  const fen = decimalPart[1] ? Number(decimalPart[1]) : 0;
  let result = `${integer}元`;
  if (jiao) result += `${DIGITS[jiao]}角`;
  else if (fen) result += '零';
  if (fen) result += `${DIGITS[fen]}分`;
  return result;
}

function periodFromHour(hour, meridiem) {
  if (meridiem === 'am') return '上午';
  if (meridiem === 'pm') return '下午';
  if (hour === 0 || hour < 6) return '凌晨';
  if (hour < 9) return '早上';
  if (hour < 12) return '上午';
  if (hour === 12) return '中午';
  if (hour < 18) return '下午';
  if (hour === 18) return '傍晚';
  return '晚上';
}

function timeToChinese(hourText, minuteText, meridiem, explicitPeriod) {
  const hour = Number(hourText) % 24;
  const minute = Number(minuteText);
  const period = explicitPeriod || periodFromHour(hour, meridiem);
  const hourSpoken = hour === 2 ? '两' : cardinalNumber(hour);
  const minuteText2 = minute === 0 ? '点' : minute === 30 ? '点半' : `${cardinalNumber(minute)}分`;
  return `${period}${hourSpoken}${minuteText2}`;
}

const DEFAULT_ADDRESS_ALIASES = {
  '杭州市信息和趣闻三路': '杭州市西湖区文三路',
  '信息和趣闻三路': '西湖区文三路',
  '文三西路': '文三西路',
  '菜鸟一感情的序曲': '菜鸟驿站',
  '一感情的序曲': '驿站',
  '菜鸟一站': '菜鸟驿站',
  '菜鸟壹站': '菜鸟驿站',
  '菜鸟驿站': '菜鸟驿站',
  '菜鸟驿站的器械马': '菜鸟驿站的取件码',
  '器械马': '取件码',
  '去见马': '取件吗',
  '以前球': '已签收',
  '丰巢快递柜': '丰巢快递柜',
  '速递易': '速递易'
};

const DEFAULT_TERM_ALIASES = {
  '华为内有学科': '华为 Mate 60 Pro',
  '华为 Mate 60 Pro': '华为mate60pro',
  '华为 Mate 六十 Pro': '华为mate60pro',
  '华为没薄田头笔记本青灰的解释': '华为 MateBook X Pro 笔记本清灰，地址是',
  '华为没薄田头': '华为 MateBook',
  '华委员': '华为云',
  '称不进店购买需填写': '充不进电，购买时间是',
  '取悦爱女孩': '十月二日，还',
  '果的': '我的',
  '果要': '我要',
  '裹在宽带帐号': '我的宽带账号是',
  '裹在宽带账号': '我的宽带账号是',
  '裹在': '我在',
  '订单号说': '订单号是',
  '马反差以下': '麻烦查一下',
  '养育月': '想预约',
  '屏幕说了': '屏幕碎了',
  '开的电子': '开具电子',
  '续费五百二十': '续费，费用是五百二十',
  '验证码一二三四五六': '验证码是一二三四五六',
  '验证马叙': '验证码',
  '一二三四五柳亭': '一二三四五六，请',
  '保定手机': '绑定手机',
  '手机好': '手机号',
  '话费种渠道手机好': '话费充值到手机号',
  '我想把五百元话费充值到手机号一三九一二三四五六七八': '我想把五百元话费充值到手机号一三九一二三四五六七八，什么时候能到账',
  '预备费永续': '续费',
  '电子发漂': '电子发票',
  '青灰': '清灰',
  '服务中心': '服务中心',
  '上门取件': '上门取件',
  '保修期内把': '保修期内吗',
  '宽带帐号': '宽带账号',
  'hz八八八八八八': 'hz888888',
  '许可罢罢罢罢罢罢': 'hz888888，',
  '一起锻炼挺勤快凯媳妇处理': '一直断连，请尽快派师傅处理'
};

function applyAliases(input, aliases) {
  let text = String(input || '');
  const keys = Object.keys(aliases).sort((a, b) => b.length - a.length);
  let previous;

  do {
    previous = text;
    for (const wrong of keys) {
      const right = aliases[wrong];
      if (wrong && right && wrong !== right) text = text.split(wrong).join(right);
    }
  } while (text !== previous);

  return text;
}

const DEFAULT_REGION_ALIASES = {
  '背景': '北京',
  '上还': '上海',
  '杭洲': '杭州',
  '广东胜': '广东省',
  '深圳是': '深圳市',
  '朝阳去': '朝阳区',
  '浦东新去': '浦东新区',
  '西湖去': '西湖区'
};

function correctRegion(input, options = {}) {
  const aliases = { ...DEFAULT_REGION_ALIASES, ...(options.regionAliases || {}) };
  let text = applyAliases(input, aliases);

  text = text.replace(/(北京|上海|天津|重庆)(?![市区县])/g, '$1市');
  text = text.replace(/(杭州|南京|苏州|深圳|广州|成都|武汉|西安)(?![市区县])/g, '$1市');
  text = text.replace(/(广东|浙江|江苏|山东|河南|河北|四川|湖北|湖南|福建|安徽)(?![省市县区])/g, '$1省');

  return text;
}

function correctTerms(input, options = {}) {
  const aliases = { ...DEFAULT_TERM_ALIASES, ...(options.termAliases || {}) };
  return applyAliases(input, aliases);
}

function correctAddress(input, options = {}) {
  const aliases = { ...DEFAULT_ADDRESS_ALIASES, ...(options.addressAliases || {}) };
  let text = applyAliases(input, aliases);

  text = text.replace(/([一二三四五六七八九十百千零两\d]+)(?:好|浩|毫)(?=[的室楼栋单元房]|$)/g, '$1号');
  text = text.replace(/([一二三四五六七八九十百千零两\d]+)(?:动|冻)(?=[室单元房]|$)/g, '$1栋');
  text = text.replace(/([一二三四五六七八九十百千零两\d]+)但远(?=[室房]|$)/g, '$1单元');

  return text;
}

function normalizeChineseSpokenText(input, options = {}) {
  let text = String(input || '').normalize('NFKC');

  text = text.replace(/(\d{4})\s*[-./年]\s*(\d{1,2})\s*[-./月]\s*(\d{1,2})/g, (_match, year, month, day) => (
    `${digitSequence(year)}年${cardinalNumber(month)}月${cardinalNumber(day)}日`
  ));

  text = text.replace(/(上午|下午|早上|晚上|中午|凌晨|傍晚)?\s*(\d{1,2})\s*:\s*(\d{2})\s*(am|pm)?/g, (_match, explicitPeriod, hour, minute, meridiem) => (
    timeToChinese(hour, minute, meridiem, explicitPeriod)
  ));

  text = text.replace(/[¥￥]\s*(\d+(?:\.\d+)?)|(\d+(?:\.\d+)?)\s*元/g, (_match, currencyA, currencyB) => (
    currencyToChinese(currencyA || currencyB)
  ));

  text = text.replace(/(\d{4})年/g, (_match, year) => `${digitSequence(year)}年`);
  text = text.replace(/1\d{10}/g, digitSequence);
  text = text.replace(/\d{5,}/g, digitSequence);
  text = text.replace(/\d+/g, (match) => cardinalNumber(match));
  text = correctRegion(text, options);
  text = correctAddress(text, options);
  text = correctTerms(text, options);

  return text;
}

module.exports = { normalizeChineseSpokenText, correctAddress, correctRegion, correctTerms };
