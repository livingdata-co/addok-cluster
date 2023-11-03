# addok-cluster

![npm](https://img.shields.io/npm/v/addok-cluster) ![node-current](https://img.shields.io/node/v/addok-cluster) [![Coverage Status](https://coveralls.io/repos/github/livingdata-co/addok-cluster/badge.svg?branch=main)](https://coveralls.io/github/livingdata-co/addok-cluster?branch=main) ![Libraries.io dependency status for latest release](https://img.shields.io/librariesio/release/npm/addok-cluster)

A very fast and efficient way to use [addok](https://github.com/addok/addok) geocoding capabilities in your Node.js process.

## Features

- Manage multiple [addok](https://github.com/addok/addok) nodes
- Fluent JavaScript API
- 30% more efficient than HTTP calls
- Fast priority queue (high, medium, low)
- Supports `AbortController`
- Auto-restart nodes
- Handle multiple Redis databases (round robin)

## Prerequisites

- Node.js 18 LTS and above
- Be able to use [ESM](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Modules)
- A working environment for addok (Python, Redis, dependencies…)

## Install

```
npm install addok-cluster
```

## Configure

```js
import {createCluster} from 'addok-cluster'

const cluster = await createCluster(options)
```

| Environment variable name | Option name | Description |
| --- | --- | --- |
| `PYTHON_PATH` | `pythonPath` | Path to `python` executable to use |
| `ADDOK_CLUSTER_NUM_NODES` | `numNodes` | Number of nodes to instantiate (default to number of CPUs) |
| `ADDOK_CONFIG_MODULE` | `addokConfigModule` | Path to addok configuration file |
| `ADDOK_REDIS_URL` | `addokRedisUrl` | Connection string to addok Redis instance (can be an array) |

## Use

### Geocode

```js
const params = {
  q: '1 rue de la paix 75002 Paris',
  autocomplete: false,
  lon: null,
  lat: null,
  limit: 5,
  filters: {
    postcode: '75002',
    citycode: '75102'
  }
}

const options = {
  priority: 'medium',
  signal: null
}

const results = await cluster.geocode(params, options)
```

| Param | Description | Default |
| --- | --- | --- |
| `q` | Text input to geocode (required) | |
| `autocomplete` | Auto-complete mode (`boolean`) | `false` |
| `lon`, `lat` | Coordinates of reference position | |
| `limit` | Number of returned results | `5` |
| `filters` | Additional filters (depend on addok config) | `{}` |

### Reverse geocode

```js
const params = {
  lon: null,
  lat: null,
  limit: 5,
  filters: {
    type: 'housenumber'
  }
}

const options = {
  priority: 'high',
  signal: null
}

const results = await cluster.reverse(params, options)
```

| Param | Description | Default |
| --- | --- | --- |
| `lon`, `lat` | Coordinates of reference position (required) | |
| `limit` | Number of returned results | `5` |
| `filters` | Additional filters (depend on addok config) | `{}` |

### Options

`priority`: `low` | `medium` (default) | `high`

Define the priority level of the request. Requests are processed following FIFO rule, from high to low.

`signal`: `AbortSignal` instance (optional)

If an `AbortSignal` instance is provided, its status is checked just before forwarding to addok.

### Stop cluster

```js
cluster.end()
```

## Sponsorship

This software is maintained by [Living Data](https://livingdata.co), thanks to the support of partners such as [Etalab](https://www.etalab.gouv.fr) (API Adresse) and [IGN](https://www.ign.fr) (Géoplateforme).
