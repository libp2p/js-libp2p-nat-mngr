# Requirements

- mapper should be able to hold multiple mappings for the same external
  port but different external ips
  - for example, if the client moves around (laptops, mobile devices) and connects
    from different access points, the mapper should be able to detect if we're using
    a different external ip/getaway for which we don't have a prior mapping and add one
- mapper should be able to auto-renew after a timeout
- mapper should be plugable - different nat techniques should be easy to adapt
