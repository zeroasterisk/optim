# Optim

Automatically optimize your images on S3 with the magic of AWS Lambda.

`imagemin-on-aws-lambda` is a fork of [Optim][optim].

It is a super-simple [Lambda][l] function that can listen to an S3 bucket for uploads, and runs everything it can through [imagemin][imagemin].

Currently supported:
* PNG
* GIF
* JPG
* SVG
* WEBP

## Setup

Clone this repo:

    git clone https://github.com/zeroasterisk/optim.git

Install Node packages:

    npm install

Configure AWS credientials if they are not already set in your environment:

    aws configure

Create an IAM role for Optim to use. It needs the following permissions on all the S3 buckets you want to use (allowing these operations on ARN `*` is easiest to start with):
   * `getObject`
   * `putObject`
   * `putObjectAcl`

Find the ARN for this role. It looks something like `arn:aws:iam::111111111111:role/YOURROLEHERE`.

Create with claudia for the first time:

    npm run create --role arn:aws:iam::111111111111:role/YOURROLEHERE --region us-east-1 --memory 1536 --timeout 300 --version development --handler bin.default --name image-optim

You can now hook this function up to any S3 bucket you like in the management console. Easiest way is to follow [AWS's guide][s3-evt-setup]

## Scripts

Extract ImageMagick:

    npm run extract-imagemagick

Update with claudia:

    npm run update

Test:

    npm run test

## Triggers

The script expects an s3 trigger.
You can invoke this directly and send in your own trigger event/data if you
make it look like this:

    {
      "Records": [ {
        "s3": {
          "object": {
            "key": "somefolder/somefile.png"
          },
          "bucket": {
            "name": "c.eltoro.com"
          }
        }
      } ]
    }


## Building on OSX or Windows?

AWS lambda runs on linux.
Sometimes packages rely on binaries which have to be for the runtime.
There are other ways to accomplish this, but here is one of the easiest.

    rm -rf node_modules
    docker run -v "${PWD}:/var/task" "/Users/<name>/.aws:/root/.aws" lambci/lambda:build "npm i && npm run update"

NOTE: this *should* work, but I have had issues with it. _WIP_

## Acknowledgements

Big credit goes to [Optim][optim] the original project, which is 80% of the code.

Also, bigger credit to the [imagemin][imagemin] project which does the heavy lifting.



[optim]: https://github.com/gosquared/optim
[l]: https://aws.amazon.com/lambda/
[imagemin]: https://github.com/imagemin/imagemin
[s3-evt-setup]: http://docs.aws.amazon.com/AmazonS3/latest/UG/SettingBucketNotifications.html
