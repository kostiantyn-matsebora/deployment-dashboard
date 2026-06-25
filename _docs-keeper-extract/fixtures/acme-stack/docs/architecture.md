# Architecture

## Overview

Acme Stack is a parcel-tracking dashboard: a SPA frontend, an API backend, Terraform
infrastructure, and an E2E test layer.

## Components

| Component | Responsibility |
|---|---|
| Frontend | Render parcel state. |
| Backend | Serve the parcel API. |
| Infrastructure | Provision the environment. |
