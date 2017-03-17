import AWS from 'aws-sdk';
import imagemin from 'imagemin';
import optipng from 'imagemin-optipng';
import imageminGifsicle from 'imagemin-gifsicle';
import imageminMozjpeg from 'imagemin-mozjpeg';
import imageminPngquant from 'imagemin-pngquant';
import imageminSvgo from 'imagemin-svgo';
import imageminWebp from 'imagemin-webp';
import Async from 'async';


const s3 = new AWS.S3();

const acl = process.env.UPLOAD_ACL || 'public-read';
const uploadBucket = process.env.UPLOAD_BUCKET;
const pngLevel = +process.env.PNG_OPTIM_LEVEL || 7;
const skipSize = +process.env.MAX_FILE_SIZE || -1;


export const getHeadAndMaybeSkip = (params, cb) => {
  s3.headObject(params, (err, head) => {
    if (err) return cb(err);

    if (head.Metadata && head.Metadata.optimized) {
      console.log('Image is already optimized. Skipping.');
      return cb('skip');
    }

    if (head.ContentLength) {
      // console.log('File size is ' + head.ContentLength + ' bytes');

      if (skipSize !== -1 && head.ContentLength > skipSize) {
        console.log('Image is larger than configured threshold. Skipping.');
        return cb('skip');
      }
    }

    return cb(null, params, head);
  });
};
export const getObject = (params, head, cb) => {
  s3.getObject(params, (err, data) => {
    if (err) return cb(err);
    return cb(null, params, head, data);
  });
};
export const runImageMin = (params, head, obj, cb) => {
  // console.log('Optimizing!');
  // console.log(obj.Body);
  imagemin.buffer(obj.Body, {
    plugins: [
      imageminGifsicle(),
      imageminMozjpeg(),
      imageminPngquant({ quality: '65-80' }),
      imageminSvgo({ plugins: [{ removeViewBox: false }] }),
      imageminWebp({ quality: 50 }),
    ],
  }).then(buf => {
    // console.log(buf);
    // console.log('Optimized! Final file size is ' + buf.length + ' bytes');
    cb(null, params, head, obj, buf);
  }).catch(err => {
    console.log('imagemin error thrown!');
    console.log(err.message || err.reason || '?');
    return cb(err);
  });
};
export const uploadMinifiedFile = (params, head, obj, buf, cb) => {
  const sizeInit = head.ContentLength;
  const sizeEnd = buf.length;
  const sizeTrimmedPercent = Math.round(1000 * ((sizeInit - sizeEnd) / sizeInit)) / 10;

  // modify metadata (from initial head request)
  head.Metadata.sizeTrimmedPercent = sizeTrimmedPercent;
  head.Metadata.optimized = 'yes';

  s3.putObject({
    ACL: acl,
    Bucket: params.Bucket,
    Key: params.Key,
    Body: buf,
    ContentType: obj.ContentType,
    Metadata: head.Metadata,
  }, err => {
    if (err) return cb(err);
    return cb(null, { sizeInit, sizeEnd, sizeTrimmedPercent });
  });
};


const doOptimizeFile = (s3file, callback) => {
  const { bucket, key } = s3file;
  console.log(`IMAGE OPTIM: ${bucket} ${key}`);
  if (!/\.(jpe?g|png|gif|svg|webp)$/.test(key)) {
    const err = new Error('Not a supported image type');
    return callback(err);
  }
  const params = { Bucket: bucket, Key: key };
  Async.waterfall([
    (cb) => (cb(null, params)),
    getHeadAndMaybeSkip,
    getObject,
    runImageMin,
    uploadMinifiedFile,
  ], (err, out) => {
    if (err && err === 'skip') {
      return callback(null, 'skipped');
    }
    if (err) {
      return callback(err, 'errored');
    }
    const { sizeInit, sizeEnd, sizeTrimmedPercent } = out;
    console.log(
      `Optimized & Saved!
          ${sizeInit} --> ${sizeEnd} bytes
          (Reduced ${sizeTrimmedPercent}%)
        `);
    return callback(null, 'success');
  });
  return '';
};

export default doOptimizeFile;

