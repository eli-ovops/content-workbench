import { randomUUID } from 'node:crypto';
// Single-flight: commands are never placed behind a pending browser operation.
export function createBroker(send, timeoutMs = 150000) {
  let active;
  return {
    request(action, extra = {}) {
      if (active) {
        if (action === 'status') {
          if (active.uncertain) return Promise.resolve({phase:'result_unknown',message:'上一项操作结果尚未核实，请勿重复提交'});
          if (active.action === 'status') return active.promise;
          return Promise.resolve({phase:'preparing',message:'专用浏览器正在操作，请稍后刷新'});
        }
        return Promise.reject(new Error('已有浏览器操作在进行或结果尚未核实，不能重复提交'));
      }
      const entry = {id:randomUUID(),action};
      entry.promise = new Promise((resolve,reject) => {entry.resolve=resolve;entry.reject=reject;});
      entry.timer = setTimeout(()=>{entry.uncertain=true;entry.reject(new Error('操作结果尚未核实，连接器已锁定重试，请在浏览器检查'));},timeoutMs);
      active = entry;
      try { send({id:entry.id,action,...extra}); }
      catch { this.abort(); }
      return entry.promise;
    },
    receive(response) {
      if (!active || active.id !== response.id) return;
      const entry=active; clearTimeout(entry.timer); active=undefined;
      response.ok ? entry.resolve(response.result) : entry.reject(new Error(response.error || 'connector_error'));
    },
    abort() {
      if (!active) return;
      clearTimeout(active.timer);active.reject(new Error('worker_unavailable'));active=undefined;
    }
  };
}
