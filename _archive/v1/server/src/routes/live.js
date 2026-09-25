import { Router } from 'express'
import { HttpError } from '../lib/errors.js'
import { getDevfolioEvents, getGdgDetail, getGdgEvents } from '../lib/live.js'

const router = Router()

const upstream = (source) => (err) => {
  throw new HttpError(502, 'upstream_unavailable', `Couldn't reach ${source} right now.`, err.message)
}

const send = (res, payload) => {
  res.set('Cache-Control', 'public, max-age=60')
  if (payload.stale) res.set('Warning', '110 - "Response is stale"')
  res.json(payload)
}

// GET /api/live/gdg[?refresh=1]: upcoming GDG events in India
router.get('/gdg', async (req, res) => {
  send(res, await getGdgEvents({ force: req.query.refresh === '1' }).catch(upstream('GDG Community')))
})

// GET /api/live/gdg/:remoteId: detail patch (photo, venue, mode, capacity, tags, description)
router.get('/gdg/:remoteId', async (req, res) => {
  if (!/^\d+$/.test(req.params.remoteId)) throw new HttpError(400, 'bad_id', 'Invalid event id.')
  res.set('Cache-Control', 'public, max-age=600').json({ detail: await getGdgDetail(req.params.remoteId).catch(upstream('GDG Community')) })
})

// GET /api/live/devfolio[?refresh=1]: open hackathons in India + online
router.get('/devfolio', async (req, res) => {
  send(res, await getDevfolioEvents({ force: req.query.refresh === '1' }).catch(upstream('Devfolio')))
})

export default router
