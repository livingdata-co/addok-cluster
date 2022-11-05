import createError from 'http-errors'

export function isFirstCharValid(string) {
  return (string.slice(0, 1).toLowerCase() !== string.slice(0, 1).toUpperCase())
    || (string.codePointAt(0) >= 48 && string.codePointAt(0) <= 57)
}

export function isNullOrUndefined(value) {
  return value === undefined || value === null
}

export function validateQ(q) {
  if (typeof q !== 'string') {
    throw createError(400, 'q must be a string')
  }

  const trimmedQ = q.trim()

  if (trimmedQ.length < 3 || !isFirstCharValid(trimmedQ)) {
    throw createError(400, 'q must contain at least 3 chars and start with a number or a letter')
  }

  return trimmedQ
}

export function validateLimit(limit) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw createError(400, 'limit must be an integer between 1 and 100')
  }

  return limit
}

export function validateAutocomplete(autocomplete) {
  if (typeof autocomplete !== 'boolean') {
    throw createError(400, 'autocomplete must be a boolean value')
  }

  return autocomplete
}

export function validateLonLat(lon, lat) {
  if ((lon && !lat) || (lat && !lon)) {
    throw createError(400, 'lon/lat must be present together if defined')
  }

  if (typeof lon !== 'number' || typeof lat !== 'number') {
    throw createError(400, 'lon/lat must be float numbers')
  }

  if (Number.isNaN(lon) || lon <= -180 || lon >= 180 || Number.isNaN(lat) || lat <= -90 || lat >= 90) {
    throw createError(400, 'lon/lat must be valid WGS-84 coordinates')
  }

  return [lon, lat]
}

export function validateFilters(filters) {
  if (typeof filters !== 'object') {
    throw createError(400, 'filters are not valid')
  }

  return filters
}

export function validateParams(params) {
  const outputParams = {}

  if (!isNullOrUndefined(params.q)) {
    outputParams.q = validateQ(params.q)
  }

  if (!isNullOrUndefined(params.limit)) {
    outputParams.limit = validateLimit(params.limit)
  }

  if (!isNullOrUndefined(params.autocomplete)) {
    outputParams.autocomplete = validateAutocomplete(params.autocomplete)
  }

  if (!isNullOrUndefined(params.lon) || !isNullOrUndefined(params.lat)) {
    const [lon, lat] = validateLonLat(params.lon, params.lat)
    outputParams.lon = lon
    outputParams.lat = lat
  }

  if (!isNullOrUndefined(params.filters)) {
    outputParams.filters = validateFilters(params.filters)
  }

  return outputParams
}
