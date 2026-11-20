/* Xingchi API check-in for Loon. Tokens stay in app-local storage.
 * Does not read passwords, refresh tokens, or cookies. No TLS bypass.
 * Capture requires HTTPS decryption for xingchiapi.com only.
 */
(function () {
  'use strict';
  var HOST = 'https://xingchiapi.com';
  var KEY = 'xingchi_checkin_session_v1';
  var args = typeof $argument === 'undefined' ? {} : $argument;
  if (typeof args === 'string') { try { args = JSON.parse(args); } catch (_) { args = {}; } }
  if (!args || typeof args !== 'object' || Array.isArray(args)) args = {};
  function flag(v, fallback) {
    return v === undefined || v === null ? fallback : v === true || v === 'true' || v === 1 || v === '1';
  }
  var notifications = flag(args.notify, true);
  var ended = false;
  function finish(title, message, capture) {
    if (ended) return;
    ended = true;
    // Never log response bodies, headers, tokens, or exceptions.
    if (title) {
      console.log('[Xingchi] ' + title);
      if (notifications) {
        try { $notification.post('星驰 API 签到', title, message || '', HOST + '/dashboard'); } catch (_) {}
      }
    }
    $done(capture ? {} : undefined);
  }
  function parse(s) { try { return JSON.parse(String(s)); } catch (_) { return null; } }
  function read() {
    try { var x = parse($persistentStore.read(KEY) || ''); return x && typeof x.token === 'string' ? x : null; } catch (_) { return null; }
  }
  function validToken(s) { return typeof s === 'string' && s.length >= 16 && s.length <= 16384 && /^[A-Za-z0-9._~+\/=-]+$/.test(s); }
  function header(h, name) {
    if (!h) return '';
    for (var k in h) if (k.toLowerCase() === name.toLowerCase()) return typeof h[k] === 'string' ? h[k] : '';
    return '';
  }
  var inCapture = typeof $request !== 'undefined';
  if (inCapture) {
    if (!flag(args.capture, true)) return finish('', '', true);
    try {
      var url = String($request.url || '');
      if (!/^https:\/\/xingchiapi\.com\/api\/v1\/(?:auth\/me|user\/(?:profile|checkin))(?:[?#]|$)/i.test(url)) return finish('', '', true);
      if (typeof $response === 'undefined' || Number($response.status) !== 200) return finish('', '', true);
      var body = parse($response.body);
      // Save only tokens seen on a successful authenticated response.
      if (!body || body.code !== 0 || !body.data || typeof body.data !== 'object') return finish('', '', true);
      var auth = header($request.headers, 'Authorization').match(/^Bearer\s+([^\s]+)\s*$/i);
      if (!auth || !validToken(auth[1])) return finish('', '', true);
      var previous = read();
      if (previous && previous.token === auth[1]) return finish('', '', true);
      var ok = $persistentStore.write(JSON.stringify({token: auth[1], capturedAt: Date.now()}), KEY);
      if (!ok) return finish('保存登录凭据失败', '请检查脚本本地存储后重试。', true);
      return finish('已保存登录凭据', '可关闭「抓取登录凭据」。之后手动或定时签到会使用这份凭据；失效后再开启并打开控制台。', true);
    } catch (_) { return finish('抓取未完成', '请正常打开控制台后再试；原始网页响应未修改。', true); }
  }
  var session = read();
  if (!session || !validToken(session.token)) return finish('尚未获取登录凭据', '打开插件「抓取登录凭据」，开启本站 HTTPS 解密并信任证书，再用 Safari 登录并打开控制台。');
  function request(method, callback) {
    var options = {
      url: HOST + '/api/v1/user/checkin',
      timeout: 12000,
      insecure: false,
      'auto-redirect': false,
      'auto-cookie': false,
      headers: {
        'Authorization': 'Bearer ' + session.token,
        'Accept': 'application/json',
        'Accept-Language': 'zh-CN',
        'X-User-UI-Request': '1',
        'Referer': HOST + '/dashboard'
      }
    };
    if (method === 'post') options.headers.Origin = HOST;
    try { $httpClient[method](options, callback); }
    catch (_) { callback(true, null, ''); }
  }
  function decode(error, response, raw) {
    if (error || !response) return {kind: 'network'};
    var status = Number(response.status);
    if (status === 401 || status === 403) return {kind: 'auth', status: status};
    if (status === 429) return {kind: 'limited'};
    var json = parse(raw);
    if (json && (json.reason === 'CHECKIN_ALREADY_CLAIMED' || json.data && json.data.reason === 'CHECKIN_ALREADY_CLAIMED')) return {kind: 'already'};
    if (status < 200 || status >= 300) return {kind: 'http', status: status};
    if (!json || json.code !== 0 || !json.data || typeof json.data !== 'object') return {kind: 'invalid'};
    return {kind: 'ok', data: json.data};
  }
  function failure(r, afterPost) {
    if (r.kind === 'auth') return finish('登录失效或请求被拦截', 'HTTP ' + r.status + '。请打开抓取开关，在官网正常登录并打开控制台；若仍失败请先确认官网可签到。');
    if (r.kind === 'limited') return finish('站点限流', '本次不重试，请稍后在官网查看签到状态。');
    if (r.kind === 'already') return finish('今日已签到', '站点表示今天已经领取，本次不会重复领取。');
    var detail = r.kind === 'http' ? 'HTTP ' + r.status + '。' : '';
    return finish(afterPost ? '未确认本次签到结果' : '无法查询签到状态', detail + (afterPost ? '已发送领取请求但没有收到明确确认，不自动重试。请在官网查看额度和签到状态。' : '未发送领取请求。请检查网络、HTTPS 解密证书或官网状态。'));
  }
  function amountText(v) {
    if ((typeof v !== 'number' && typeof v !== 'string') || String(v).trim() === '') return null;
    var n = Number(v);
    return isFinite(n) && n >= 0 ? String(n) : null;
  }
  request('get', function (error, response, raw) {
    if (ended) return;
    var result = decode(error, response, raw);
    if (result.kind !== 'ok') return failure(result, false);
    var status = result.data;
    if (status.claimed_today === true) return finish('今日已签到', '查询确认今天已领取，未重复发送签到请求。');
    if (status.enabled === false) return finish('站点未开启签到', '官网当前关闭了签到功能，未发送领取请求。');
    if (status.enabled !== true || status.claimed_today !== false) return finish('签到状态格式变化', '未发送领取请求，请在官网查看。');
    request('post', function (error, response, raw) {
      if (ended) return;
      var claimed = decode(error, response, raw);
      if (claimed.kind !== 'ok') return failure(claimed, true);
      var data = claimed.data;
      var amount = amountText(data.amount);
      if (!data.status || data.status.claimed_today !== true || amount === null) {
        return finish('未确认本次签到结果', '站点返回字段不足以确认奖励，请在官网查看额度。不自动重复领取。');
      }
      finish('签到成功', '本次奖励：' + amount + '（按站点额度单位）。\n服务器已确认今日领取状态，请以官网余额或记录核对实际到账。');
    });
  });
})();
