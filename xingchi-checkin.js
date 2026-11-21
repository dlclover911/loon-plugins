/* Xingchi API check-in for Loon. Credentials stay in app-local storage.
 * Optional renewal requires explicit, time-limited enrollment of a separate session.
 * Never reads passwords, request bodies, or cookies. No TLS bypass.
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
  var renewOn = flag(args.autoRenew, false);
  var renewKey = 'xingchi_checkin_dedicated_renew_v1';
  var held = '';
  var ended = false;
  function loadRenew() {
    try { return parse($persistentStore.read(renewKey) || '') || {}; } catch (_) { return {}; }
  }
  function saveRenew(value) {
    try { return !!$persistentStore.write(JSON.stringify(value), renewKey); } catch (_) { return false; }
  }
  function activeLock(s) { return !!s.lock && Number(s.lockUntil) > Date.now(); }
  function finish(title, message, capture) {
    if (ended) return;
    ended = true;
    if (held) {
      var state = loadRenew();
      if (state.lock === held) {
        delete state.lock;
        delete state.lockUntil;
        saveRenew(state);
      }
    }
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
  function nonce() { return Date.now() + '-' + Math.random().toString(36).slice(2); }
  function pairFrom(data) {
    if (!data || !validToken(data.access_token) || !validToken(data.refresh_token) || data.access_token === data.refresh_token) return null;
    if (typeof data.expires_in !== 'number' || !isFinite(data.expires_in) || data.expires_in <= 0 || data.expires_in > 31536000) return null;
    return {token: data.access_token, refresh: data.refresh_token, expiresAt: Date.now() + data.expires_in * 1000};
  }
  function enrollment() {
    var s = loadRenew();
    if (!s.arm || Number(s.armUntil) <= Date.now() || activeLock(s)) return finish('', '', true);
    if (String($request.method || '').toUpperCase() !== 'POST' || typeof $response === 'undefined' || Number($response.status) !== 200) return finish('', '', true);
    var body = parse($response.body);
    var pair = body && body.code === 0 ? pairFrom(body.data) : null;
    if (!pair) return finish('', '', true);
    var latest = loadRenew();
    if (latest.arm !== s.arm || activeLock(latest) || Number(latest.armUntil) <= Date.now()) return finish('', '', true);
    if (!saveRenew({pair: pair})) return finish('保存续期会话失败', '请检查客户端本地存储。', true);
    return finish('已绑定独立续期会话', '请关闭刚登录的 Safari 无痕标签页，不要点退出登录。之后手动签到验证。', true);
  }
  var inCapture = typeof $request !== 'undefined';
  if (inCapture) {
    try {
      var url = String($request.url || '');
      if (renewOn && /^https:\/\/xingchiapi\.com\/api\/v1\/auth\/login(?:\/2fa)?(?:\?[^#]*)?$/.test(url)) return enrollment();
      if (!flag(args.capture, true)) return finish('', '', true);
      if (!/^https:\/\/xingchiapi\.com\/api\/v1\/(?:auth\/me|user\/(?:profile|checkin))(?:[?#]|$)/i.test(url)) return finish('', '', true);
      if (typeof $response === 'undefined' || Number($response.status) !== 200) return finish('', '', true);
      var body = parse($response.body);
      // Save only tokens seen on a successful authenticated response.
      if (!body || body.code !== 0 || !body.data || typeof body.data !== 'object') return finish('', '', true);
      var auth = header($request.headers, 'Authorization').match(/^Bearer\s+([^\s]+)\s*$/i);
      if (!auth || !validToken(auth[1])) return finish('', '', true);
      if (renewOn) {
        var isolated = loadRenew();
        if ((isolated.arm && Number(isolated.armUntil) > Date.now()) || (isolated.pair && isolated.pair.token === auth[1])) return finish('', '', true);
      }
      var previous = read();
      if (previous && previous.token === auth[1]) return finish('', '', true);
      var ok = $persistentStore.write(JSON.stringify({token: auth[1], capturedAt: Date.now()}), KEY);
      if (!ok) return finish('保存登录凭据失败', '请检查脚本本地存储后重试。', true);
      return finish('已保存登录凭据', '可关闭「抓取登录凭据」。之后手动或定时签到会使用这份凭据；失效后再开启并打开控制台。', true);
    } catch (_) { return finish('抓取未完成', '请正常打开控制台后再试；原始网页响应未修改。', true); }
  }
  var tag = typeof $script !== 'undefined' && $script ? $script.name : '';
  if (tag === '星驰 API 清除续期会话') {
    if (activeLock(loadRenew())) return finish('签到任务运行中', '任务结束后再清除续期会话。');
    if (!saveRenew({})) return finish('清除续期会话失败', '请检查客户端本地存储。');
    return finish('已清除续期会话', '原来的登录凭据不受影响。此操作不向官网发送请求。');
  }
  if (tag === '星驰 API 绑定独立续期会话') {
    if (!renewOn) return finish('自动续期尚未开启', '请在插件设置开启「自动续期」，再运行绑定。');
    var binding = loadRenew();
    if (activeLock(binding)) return finish('签到任务运行中', '任务结束后再绑定续期会话。');
    binding.arm = nonce();
    binding.armUntil = Date.now() + 180000;
    if (!saveRenew(binding)) return finish('无法开启绑定', '请检查客户端本地存储。');
    return finish('请在 3 分钟内登录星驰', '用 Safari 无痕标签页正常登录自己的星驰账号。绑定成功后关闭该标签页，不要点退出登录。');
  }
  var renewal = renewOn ? loadRenew() : {};
  if (renewOn && activeLock(renewal)) return finish('签到任务运行中', '本次未发请求。');
  if (renewOn && renewal.arm && Number(renewal.armUntil) > Date.now()) return finish('等待绑定独立续期会话', '请先完成绑定，或等绑定窗口结束。');
  if (renewOn && renewal.phase) return finish('续期会话需要重新绑定', '上次续期未能安全确认；不会重复使用旧刷新令牌。请重新绑定，或关闭自动续期使用原模式。');
  var verifyOnly = tag === '星驰 API 验证续期（不签到）';
  var useRenew = renewOn && !!renewal.pair;
  if (verifyOnly && !useRenew) return finish('没有可验证的续期会话', '请开启自动续期并先绑定独立会话。');
  var session = useRenew ? renewal.pair : read();
  if (!session || !validToken(session.token)) return finish('尚未获取登录凭据', '可开启「抓取登录凭据」并访问官网控制台；若要用自动续期，请先运行「绑定独立续期会话」。');
  if (useRenew) {
    if (!validToken(session.refresh) || !isFinite(session.expiresAt) || Number(session.expiresAt) <= 0) return finish('续期会话格式无效', '请重新绑定。');
    var id = nonce();
    renewal.lock = id;
    renewal.lockUntil = Date.now() + 90000;
    if (!saveRenew(renewal) || loadRenew().lock !== id) return finish('无法锁定续期会话', '本次未发请求。');
    held = id;
  }
  function ownsSession() { return !held || (function (s) { return s.lock === held && activeLock(s); })(loadRenew()); }
  function requireSession() {
    if (ownsSession()) return true;
    finish('续期会话已变化', '已停止当前任务，请检查绑定后再运行。');
    return false;
  }
  function send(method, options, callback) {
    var called = false;
    function once(e, r, b) { if (called) return; called = true; callback(e, r, b); }
    try { $httpClient[method](options, once); }
    catch (_) { once(true, null, ''); }
  }
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
    send(method, options, callback);
  }
  var attemptedRenewal = false;
  function refreshThen(next) {
    if (!requireSession()) return;
    attemptedRenewal = true;
    var pending = loadRenew();
    // Mark intent before transmitting: a dropped response can hide a server-side rotation.
    pending.phase = 'refreshing';
    if (pending.lock !== held || !saveRenew(pending) || !requireSession()) return finish('无法记录续期状态', '未发送续期请求。');
    send('post', {
      url: HOST + '/api/v1/auth/refresh',
      timeout: 30000,
      insecure: false,
      'auto-redirect': false,
      'auto-cookie': false,
      headers: {'Content-Type': 'application/json', 'Accept': 'application/json', 'Origin': HOST},
      body: JSON.stringify({refresh_token: session.refresh})
    }, function (error, response, raw) {
      if (ended || !requireSession()) return;
      var s = loadRenew();
      if (s.lock !== held) return finish('续期会话已变化', '已停止当前任务。');
      var status = response ? Number(response.status) : 0;
      var json = !error && status === 200 ? parse(raw) : null;
      var updated = json && json.code === 0 ? pairFrom(json.data) : null;
      if (!updated) {
        // Never replay a possibly consumed refresh token after an ambiguous result.
        s.phase = 'rebind';
        delete s.pair;
        saveRenew(s);
        var rejected = !error && (status === 401 || status === 403);
        return finish(rejected ? '续期凭据已失效或被拒绝' : '未能确认续期结果', '本次不会签到或自动重试。请重新绑定独立会话。');
      }
      s.pair = updated;
      delete s.phase;
      if (!saveRenew(s) || !requireSession()) return finish('未能保存续期结果', '请重新绑定独立会话。本次不再发请求。');
      session = updated;
      next();
    });
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
  function query() {
    if (!requireSession()) return;
    request('get', function (error, response, raw) {
    if (ended || !requireSession()) return;
    var result = decode(error, response, raw);
    if (useRenew && !attemptedRenewal && result.kind === 'auth' && result.status === 401) return refreshThen(query);
    if (useRenew && result.kind === 'auth') return finish('续期会话无法用于签到', 'HTTP ' + result.status + '。本次未发送领取请求；请检查官网能否签到，必要时重新绑定。');
    if (result.kind !== 'ok') return failure(result, false);
    var status = result.data;
    if (status.claimed_today === true) return finish('今日已签到', '查询确认今天已领取，未重复发送签到请求。');
    if (status.enabled === false) return finish('站点未开启签到', '官网当前关闭了签到功能，未发送领取请求。');
    if (status.enabled !== true || status.claimed_today !== false) return finish('签到状态格式变化', '未发送领取请求，请在官网查看。');
    request('post', function (error, response, raw) {
      if (ended || !requireSession()) return;
      var claimed = decode(error, response, raw);
      if (useRenew && claimed.kind === 'auth') return finish('领取请求未获授权', 'HTTP ' + claimed.status + '。未重新发送领取请求，请到官网核对签到状态。');
      if (claimed.kind !== 'ok') return failure(claimed, true);
      var data = claimed.data;
      var amount = amountText(data.amount);
      if (!data.status || data.status.claimed_today !== true || amount === null) {
        return finish('未确认本次签到结果', '站点返回字段不足以确认奖励，请在官网查看额度。不自动重复领取。');
      }
      finish('签到成功', '本次奖励：' + amount + '（按站点额度单位）。\n服务器已确认今日领取状态，请以官网余额或记录核对实际到账。');
    });
    });
  }
  if (verifyOnly) return refreshThen(function () { finish('续期验证成功', '已保存更新后的独立会话，未查询或领取签到奖励。'); });
  if (useRenew && session.expiresAt - Date.now() <= 120000) return refreshThen(query);
  query();
})();
