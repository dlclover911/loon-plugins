(function () {
  'use strict';
  var origin = 'https://agentrouter.org';
  var consoleURL = origin + '/console';
  var args = typeof $argument !== 'undefined' ? $argument : {};
  if (typeof args === 'string') {
    try { args = JSON.parse(args); } catch (_) { args = {}; }
  }
  if (!args || typeof args !== 'object' || Array.isArray(args)) args = {};
  function enabled(value, fallback) {
    if (value === undefined || value === null) return fallback;
    return value === true || value === 'true' || value === 1 || value === '1';
  }
  var choices = [enabled(args.usePassword, true), enabled(args.useGithub, false), enabled(args.useLinuxdo, false)];
  var selectedCount = choices.filter(function (value) { return value; }).length;
  var mode = choices[0] ? 'password' : choices[1] ? 'github' : 'linuxdo';
  function finish(title, detail) {
    console.log('[AgentRouter] ' + title);
    try { $notification.post('AgentRouter 签到', title, detail, consoleURL); } catch (_) {}
    $done();
  }
  function decode(body) {
    try { return JSON.parse(body); } catch (_) { return null; }
  }
  function headers(json) {
    var h = { Accept: 'application/json' };
    if (json) {
      h['Content-Type'] = 'application/json';
      h.Origin = origin;
      h.Referer = origin + '/login';
    }
    return h;
  }
  function options(path, json) {
    return { url: origin + path, timeout: 10000, headers: headers(json),
      insecure: false, 'auto-redirect': false, 'auto-cookie': false };
  }
  if (selectedCount !== 1) return finish('请只开启一种登录方式', '在插件设置中，邮箱或用户名、GitHub、Linux DO 三项只保留一项开启。未发送登录请求。');
  if (mode === 'github' || mode === 'linuxdo') {
    var provider = mode === 'github' ? 'GitHub' : 'Linux DO';
    return finish(provider + ' · 请完成官网授权', '点通知打开控制台；如已登录，先点「注销」，再选「使用 ' + provider + ' 登录」。');
  }
  var account = typeof args.account === 'string' ? args.account.trim() : '';
  var password = typeof args.sitePassword === 'string' ? args.sitePassword : '';
  if (!account || !password) return finish('尚未填写站内账号或密码', '仅在 Loon 本机设置填写。请勿填写 Google 邮箱的密码。');
  $httpClient.get(options('/api/status', false), function (error, response, body) {
    var status = !error && response && response.status === 200 ? decode(body) : null;
    if (!status || !status.data || typeof status.data.turnstile_check !== 'boolean') {
      return finish('无法确认站点登录状态', '未发送密码，请稍后在官网查看。');
    }
    if (status.data.turnstile_check) return finish('官网要求人机验证', '未发送密码。请点通知，在浏览器完成验证和登录。');
    var request = options('/api/user/login?turnstile=', true);
    request.body = JSON.stringify({ username: account, password: password });
    $httpClient.post(request, function (error, response, body) {
      if (error || !response) return finish('未确认签到结果', '连接失败，未自动重试。请先检查官网额度。');
      if (response.status === 429) return finish('触发站点限流', '未自动重试，请稍后在官网检查。');
      if (response.status !== 200) return finish('站点未受理登录', 'HTTP ' + Number(response.status) + '，请在官网检查。');
      var result = decode(body);
      if (!result || typeof result.success !== 'boolean') return finish('未确认签到结果', '响应不是预期格式，请在官网检查。');
      if (!result.success) return finish('登录未成功', '请在官网确认账号、密码或是否需要验证。');
      if (result.data && result.data.checked_in === true) return finish('签到成功', 'AgentRouter 确认新增额度已到账。');
      return finish('登录成功，未确认新增额度', '站点没返回签到成功。可能今天已领取，请在官网看余额；若仍未到账，按官网说明先退出再重新登录。');
    });
  });
})();
