<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Run the migrations.
     */
    public function up()
{
    if (!Schema::hasTable('events')) {
        Schema::create('events', function (Blueprint $table) {
            $table->id();
            $table->string('title');
            $table->date('date_start');
            $table->date('date_end');
            $table->string('external_id')->unique();
            $table->string('event_link');
            $table->string('image_url')->nullable();
            $table->boolean('sold_out')->default(false);
            $table->timestamps();
        });
    }
}

    
    public function down()
    {
        Schema::dropIfExists('events');
    }
    
};
