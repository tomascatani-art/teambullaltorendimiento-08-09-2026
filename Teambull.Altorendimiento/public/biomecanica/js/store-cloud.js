// Backend en la nube (Supabase): misma interfaz que localStore en store.js.
const toAthlete = (r) => r && ({ id: r.id, coachId: r.coach_id, email: r.email || '', name: r.name, year: r.year || '', sex: r.sex || '', club: r.club || '', category: r.category || '', events: r.events || '', notes: r.notes || '', plans: r.plans || [], createdAt: r.created_at, updatedAt: r.updated_at });
const fromAthlete = (a) => ({ email: a.email ? a.email.trim().toLowerCase() : null, name: a.name, year: a.year || null, sex: a.sex || '', club: a.club || null, category: a.category || null, events: a.events || null, notes: a.notes || null, plans: a.plans || [] });
const toEval = (r) => r && ({ id: r.id, athleteId: r.athlete_id, kind: r.kind, date: r.date || '', title: r.title, event: r.event || '', summary: r.summary || {}, data: r.data, shared: r.shared !== false, sourceKey: r.source_key, videoPath: r.video_path, createdAt: r.created_at, updatedAt: r.updated_at });
const fromEval = (e) => ({ athlete_id: e.athleteId, kind: e.kind, date: e.date || null, title: e.title, event: e.event || null, summary: e.summary || {}, data: e.data, shared: e.shared !== false, source_key: e.sourceKey || null, video_path: e.videoPath || null });

function check({ data, error }) {
  if (error) throw new Error(error.message || 'Error de la base de datos');
  return data;
}

const toComment = (r, uid) => ({ id: r.id, evaluationId: r.evaluation_id, body: r.body, authorRole: r.author_role, authorName: r.author_name || '', mine: r.author_id === uid, createdAt: r.created_at });

export function cloudStore(sb, cfg) {
  const uid = async () => (await sb.auth.getUser()).data.user?.id;
  return {
    backend: 'cloud',
    async available() { return true; },
    // alumnos propios (la base también deja ver la ficha propia cuando un entrenador carga tu email)
    async listAthletes() { return check(await sb.from('athletes').select('*').eq('coach_id', await uid()).order('name')).map(toAthlete); },
    // fichas que un entrenador compartió con este usuario (por su email confirmado)
    async sharedSheets() {
      const me = await uid();
      const rows = check(await sb.from('athletes').select('*').neq('coach_id', me).order('name')).map(toAthlete);
      if (!rows.length) return rows;
      const coaches = check(await sb.from('profiles').select('id, full_name').in('id', [...new Set(rows.map(r => r.coachId))]));
      return rows.map(r => ({ ...r, coachName: coaches.find(c => c.id === r.coachId)?.full_name || '' }));
    },
    async listComments(evaluationId) {
      const me = await uid();
      return check(await sb.from('comments').select('*').eq('evaluation_id', evaluationId).order('created_at')).map(r => toComment(r, me));
    },
    async addComment(evaluationId, body, who = {}) {
      return toComment(check(await sb.from('comments').insert({ evaluation_id: evaluationId, body, author_role: who.role || 'coach', author_name: who.name || null }).select().single()), await uid());
    },
    async deleteComment(id) { check(await sb.from('comments').delete().eq('id', id)); },
    async getAthlete(id) { return toAthlete(check(await sb.from('athletes').select('*').eq('id', id).maybeSingle())); },
    async saveAthlete(a) {
      const q = a.id ? sb.from('athletes').update(fromAthlete(a)).eq('id', a.id) : sb.from('athletes').insert(fromAthlete(a));
      return toAthlete(check(await q.select().single()));
    },
    async deleteAthlete(id) {
      const evs = await this.listEvaluations(id);
      const paths = evs.map(e => e.videoPath).filter(Boolean);
      if (paths.length) await sb.storage.from('videos').remove(paths);
      check(await sb.from('athletes').delete().eq('id', id));
    },
    async listEvaluations(athleteId) {
      return check(await sb.from('evaluations').select('*').eq('athlete_id', athleteId).order('date', { ascending: false }).order('created_at', { ascending: false })).map(toEval);
    },
    async getEvaluation(id) { return toEval(check(await sb.from('evaluations').select('*').eq('id', id).maybeSingle())); },
    async saveEvaluation(e) {
      const q = e.id ? sb.from('evaluations').update(fromEval(e)).eq('id', e.id) : sb.from('evaluations').insert(fromEval(e));
      return toEval(check(await q.select().single()));
    },
    async deleteEvaluation(id) {
      const e = await this.getEvaluation(id);
      if (e?.videoPath) await sb.storage.from('videos').remove([e.videoPath]);
      check(await sb.from('evaluations').delete().eq('id', id));
    },
    async exportAll() {
      const athletes = await this.listAthletes();
      const evaluations = check(await sb.from('evaluations').select('*').eq('coach_id', await uid())).map(toEval);
      return { app: 'SwimBull', kind: 'backup', version: 1, exportedAt: new Date().toISOString(), athletes, evaluations };
    },
    // importa una copia (por ejemplo, los datos que estaban en el dispositivo); crea ids nuevos
    async importAll(data) {
      if (!data || data.kind !== 'backup') throw new Error('El archivo no es una copia de seguridad de SwimBull.');
      const map = {};
      for (const a of data.athletes) map[a.id] = (await this.saveAthlete({ ...a, id: undefined })).id;
      let n = 0;
      for (const e of data.evaluations) {
        if (!map[e.athleteId]) continue;
        await this.saveEvaluation({ ...e, id: undefined, videoPath: null, athleteId: map[e.athleteId] });
        n++;
      }
      return { athletes: data.athletes.length, evaluations: n };
    },
    // videos
    canStoreVideo: true,
    maxVideoBytes: (cfg.maxVideoMB || 50) * 1048576,
    async uploadVideo(evaluationId, file) {
      if (file.size > this.maxVideoBytes) throw new Error(`El video pesa ${(file.size / 1048576).toFixed(0)} MB y el máximo es ${cfg.maxVideoMB} MB. Recortalo a la prueba o bajale la calidad.`);
      const { data: { user } } = await sb.auth.getUser();
      const ext = (file.name.split('.').pop() || 'mp4').toLowerCase().replace(/[^a-z0-9]/g, '');
      const path = `${user.id}/${evaluationId}.${ext}`;
      check(await sb.storage.from('videos').upload(path, file, { upsert: true, contentType: file.type || 'video/mp4' }));
      check(await sb.from('evaluations').update({ video_path: path }).eq('id', evaluationId));
      return path;
    },
    // revisión para el nadador: filas en review_items y archivos en videos/<entrenador>/reviews/<evaluación>/
    async listReviewItems(evaluationId) {
      return check(await sb.from('review_items').select('*').eq('evaluation_id', evaluationId).order('created_at')).map(r => ({ id: r.id, evaluationId: r.evaluation_id, kind: r.kind, title: r.title, path: r.path, type: r.content_type, createdAt: r.created_at, seenAt: r.seen_at }));
    },
    async addReviewItem(evaluationId, file, { kind, title }) {
      if (file.size > this.maxVideoBytes) throw new Error(`El archivo pesa ${(file.size / 1048576).toFixed(0)} MB y el máximo es ${cfg.maxVideoMB} MB.`);
      const id = crypto.randomUUID(), u = await uid();
      const ext = (file.name.split('.').pop() || 'mp4').toLowerCase().replace(/[^a-z0-9]/g, '');
      const path = `${u}/reviews/${evaluationId}/${id}.${ext}`;
      check(await sb.storage.from('videos').upload(path, file, { contentType: file.type || 'video/mp4' }));
      check(await sb.from('review_items').insert({ id, evaluation_id: evaluationId, kind, title, path, content_type: file.type || null }));
      return { id, kind, title, path };
    },
    async deleteReviewItem(id) {
      const r = check(await sb.from('review_items').select('path').eq('id', id).maybeSingle());
      if (r?.path) await sb.storage.from('videos').remove([r.path]);
      check(await sb.from('review_items').delete().eq('id', id));
    },
    async reviewFile(item) { return check(await sb.storage.from('videos').download(item.path)); },
    // biblioteca de ejercicios del entrenador
    async listDrills() { return check(await sb.from('drills').select('*').eq('coach_id', await uid()).order('name')).map(r => ({ id: r.id, name: r.name, note: r.note || '' })); },
    async saveDrill(d) {
      const q = d.id ? sb.from('drills').update({ name: d.name, note: d.note || null }).eq('id', d.id) : sb.from('drills').insert({ name: d.name, note: d.note || null });
      const r = check(await q.select().single());
      return { id: r.id, name: r.name, note: r.note || '' };
    },
    async deleteDrill(id) { check(await sb.from('drills').delete().eq('id', id)); },
    async markReviewSeen(id) { check(await sb.rpc('mark_review_seen', { item: id })); },
    async videoFile(path, name) {
      const blob = check(await sb.storage.from('videos').download(path));
      return new File([blob], name || path.split('/').pop(), { type: blob.type || 'video/mp4' });
    },
  };
}
