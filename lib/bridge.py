import sys, json

from addok.config import config
from addok.core import reverse, search

config.load()

sys.stdout.flush()

def prepare_params(params):
  q = params['q'] if 'q' in params.keys() else None
  autocomplete = params['autocomplete'] if 'autocomplete' in params.keys() else False
  lon = params['lon'] if 'lon' in params.keys() else None
  lat = params['lat'] if 'lat' in params.keys() else None
  filters = params['filters'] if 'filters' in params.keys() else {}
  limit = params['limit'] if 'limit' in params.keys() else 5
  return q, autocomplete, lon, lat, filters, limit

def execute_geocode(params):
  q, autocomplete, lon, lat, filters, limit = prepare_params(request['params'])

  if q is None:
    raise Exception('q must not be empty')

  results = search(
    q,
    limit=limit,
    autocomplete=autocomplete,
    lon=lon,
    lat=lat,
    **filters
  )
  return results

def execute_reverse(params):
  q, autocomplete, lon, lat, filters, limit = prepare_params(request['params'])
  results = reverse(
    limit=limit,
    lon=lon,
    lat=lat,
    **filters
  )
  return results

for line in sys.stdin:
  if line.startswith('PING?'):
    print('PONG!')
    sys.stdout.flush()
    continue

  if not line.startswith('{'):
    continue

  request = json.loads(line)

  if 'reqId' not in request.keys():
    continue

  reqId = request['reqId']

  try:
    if 'operation' not in request.keys() or request['operation'] not in ['geocode', 'reverse']:
      raise Exception('operation not found')

    operation = request['operation']

    if operation == 'geocode':
      results = execute_geocode(request['params'])

    if operation == 'reverse':
      results = execute_reverse(request['params'])

    print(json.dumps({
      "results": [r.format() for r in results],
      "reqId": reqId
    }))
  except Exception as e:
    print(json.dumps({
      "error": "{0}".format(e),
      "reqId": reqId
    }))

  sys.stdout.flush()
