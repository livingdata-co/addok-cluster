import {pickBy} from 'lodash-es'
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

  if (trimmedQ.length < 3 || trimmedQ.length > 200 || !isFirstCharValid(trimmedQ)) {
    throw createError(400, 'q must contain between 3 and 200 chars and start with a number or a letter')
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
  if ((lon && lat === undefined) || (lat && lon === undefined)) {
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

export function formatFilterValue(value) {
  if (typeof value === 'string') {
    return value
  }

  if (Array.isArray(value)) {
    // Validate that all elements are strings
    for (const item of value) {
      if (typeof item !== 'string') {
        throw createError(400, 'filter values must be strings or arrays of strings')
      }
    }

    // Join with '+' separator for addok multi-value filters
    return value.join('+')
  }

  throw createError(400, 'filter values must be strings or arrays of strings')
}

export function validateFilters(filters) {
  if (typeof filters !== 'object' || Array.isArray(filters)) {
    throw createError(400, 'filters are not valid')
  }

  const validatedFilters = {}

  for (const [key, value] of Object.entries(pickBy(filters))) {
    validatedFilters[key] = formatFilterValue(value)
  }

  return validatedFilters
}

export function validateParams(params, requiredParams = []) {
  for (const requiredParam of requiredParams) {
    if (isNullOrUndefined(params[requiredParam])) {
      throw createError(400, `${requiredParam} is a required parameter`)
    }
  }

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
